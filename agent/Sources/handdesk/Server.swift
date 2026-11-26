import Foundation
import Network
import Security
import CoreGraphics
import HandDeskCore

struct ServerConfig {
    var port: UInt16 = 8787
    var lan = false
    /// the name clients use to reach the Mac in --lan mode (Host header allowlist)
    var host: String?
    var p12Path: String?
    var webRoot: String
    var token: String
    var magnifyMode: MagnifyMode = .keys
    var invertScroll = false
    var fps = 60
    var bitrate = 25_000_000
    var maxWidth = 2560
}

/// HTTP (static page) and WebSocket (/ws) on one port. All state lives on `queue`.
final class Server {
    let queue = DispatchQueue(label: "handdesk.server")
    private let config: ServerConfig
    private let displays: [DisplayInfo]
    private let poster: EventPoster
    private var listener: NWListener?
    private var sessions: [ObjectIdentifier: Session] = [:]
    private var streams: [Int: DisplayStream] = [:]
    private var starting = Set<Int>()

    init(config: ServerConfig, displays: [DisplayInfo], poster: EventPoster) {
        self.config = config; self.displays = displays; self.poster = poster
    }

    func start() throws {
        let params: NWParameters
        if let p12 = config.p12Path {
            let tls = NWProtocolTLS.Options()
            sec_protocol_options_set_local_identity(tls.securityProtocolOptions, try Self.identity(p12Path: p12))
            params = NWParameters(tls: tls)
        } else {
            params = .tcp
        }
        let port = NWEndpoint.Port(rawValue: config.port)!
        let l: NWListener
        if config.lan {
            l = try NWListener(using: params, on: port)
        } else {
            params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: port) // reachable only from this Mac (and adb reverse)
            l = try NWListener(using: params)
        }
        l.newConnectionHandler = { [weak self] c in self?.accept(c) }
        l.stateUpdateHandler = { state in
            if case let .failed(e) = state { FileHandle.standardError.write(Data("listener failed: \(e)\n".utf8)); exit(1) }
        }
        l.start(queue: queue)
        listener = l
    }

    static func identity(p12Path: String) throws -> sec_identity_t {
        let data = try Data(contentsOf: URL(fileURLWithPath: p12Path))
        let pass = ProcessInfo.processInfo.environment["HANDDESK_P12_PASSWORD"] ?? ""
        var items: CFArray?
        guard SecPKCS12Import(data as CFData, [kSecImportExportPassphrase as String: pass] as CFDictionary, &items) == errSecSuccess,
              let first = (items as? [[String: Any]])?.first, let raw = first[kSecImportItemIdentity as String],
              let ident = sec_identity_create(raw as! SecIdentity) else {
            throw NSError(domain: "handdesk", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot import \(p12Path) (set HANDDESK_P12_PASSWORD)"])
        }
        return ident
    }

    static let maxSessions = 8

    private func accept(_ conn: NWConnection) {
        if sessions.count >= Self.maxSessions { conn.cancel(); return }
        let s = Session(connection: conn, server: self)
        sessions[ObjectIdentifier(s)] = s
        s.start()
    }

    // MARK: called by Session on `queue`

    func makeMapper() -> EventMapper {
        EventMapper(poster: poster, displays: displays, magnifyMode: config.magnifyMode, invertScroll: config.invertScroll)
    }
    var token: String { config.token }
    var hostName: String? { config.lan ? config.host : nil }
    var webRoot: String { config.webRoot }
    var displayList: [DisplayInfo] { displays }

    func remove(_ s: Session) {
        sessions[ObjectIdentifier(s)] = nil
        refreshStreams()
    }

    func subscriptionsChanged(newlySubscribed: [Int]) {
        refreshStreams()
        for i in newlySubscribed { streams[i]?.requestKeyframe() }
    }

    private func refreshStreams() {
        let wanted = Set(sessions.values.flatMap { $0.subscribed })
        for (i, s) in streams where !wanted.contains(i) { s.stop(); streams[i] = nil }
        for i in wanted where streams[i] == nil && !starting.contains(i) && displays.indices.contains(i) {
            starting.insert(i)
            let ds = DisplayStream(index: i, info: displays[i])
            ds.onFrame = { [weak self] idx, data, key, micros in
                let msg = WebSocket.encode(opcode: .binary, payload: VideoFrame.message(display: UInt8(idx), keyframe: key, micros: micros, annexB: data))
                self?.queue.async { self?.broadcast(msg, display: idx, keyframe: key) }
            }
            Task {
                do {
                    try await ds.start(fps: config.fps, bitrate: config.bitrate, maxWidth: config.maxWidth)
                    queue.async {
                        self.starting.remove(i)
                        if self.sessions.values.contains(where: { $0.subscribed.contains(i) }) {
                            self.streams[i] = ds
                            ds.requestKeyframe()
                        } else {
                            ds.stop() // everyone unsubscribed while it was starting
                        }
                    }
                } catch {
                    queue.async {
                        self.starting.remove(i)
                        let hint = CGPreflightScreenCaptureAccess() ? "" : " (grant Screen Recording to the app that runs handdesk)"
                        for s in self.sessions.values where s.subscribed.contains(i) { s.sendText(errorMessage("capture failed: \(error.localizedDescription)\(hint)")) }
                    }
                }
            }
        }
    }

    private func broadcast(_ wire: Data, display: Int, keyframe: Bool) {
        for s in sessions.values where s.subscribed.contains(display) { s.sendVideo(wire, display: display, keyframe: keyframe) }
    }
}

final class Session {
    private let conn: NWConnection
    private unowned let server: Server
    private var buffer = Data()
    private var upgraded = false
    private var mapper: EventMapper?
    private(set) var subscribed: Set<Int> = []
    private var waitingForKey = Set<Int>()
    private var pendingBytes = 0
    private var closed = false
    private var deadline: DispatchWorkItem?

    init(connection: NWConnection, server: Server) { conn = connection; self.server = server }

    func start() {
        conn.stateUpdateHandler = { [weak self] st in
            switch st {
            case .failed, .cancelled: self?.close()
            default: break
            }
        }
        conn.start(queue: server.queue)
        // a connection that has not finished the WebSocket upgrade within 10 s is dropped (slow clients, idle sockets)
        let d = DispatchWorkItem { [weak self] in if self?.upgraded == false { self?.close() } }
        deadline = d
        server.queue.asyncAfter(deadline: .now() + 10, execute: d)
        receive()
    }

    private func close() {
        guard !closed else { return }
        closed = true
        deadline?.cancel()
        mapper?.releaseAll() // never leave a mouse button or modifier held after the session ends
        conn.cancel()
        server.remove(self)
    }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, err in
            guard let self = self else { return }
            if let d = data, !d.isEmpty { self.buffer.append(d); self.process() }
            if done || err != nil { self.close() } else { self.receive() }
        }
    }

    private func process() {
        if !upgraded { processHTTP() } else { processFrames() }
    }

    private func processHTTP() {
        switch HTTP.parse(buffer) {
        case .incomplete: return
        case .malformed: send(HTTP.response(status: 400, reason: "Bad Request"), thenClose: true)
        case let .request(req, consumed):
            buffer.removeFirst(consumed)
            guard Auth.hostAllowed(host: req.headers["host"], extra: server.hostName) else {
                return send(HTTP.response(status: 403, reason: "Forbidden"), thenClose: true)
            }
            if req.path == "/ws" { upgrade(req) } else { serveStatic(req) }
        }
    }

    private func upgrade(_ req: HTTPRequest) {
        guard Auth.authorizeWebSocket(req, token: server.token) else {
            return send(HTTP.response(status: 403, reason: "Forbidden"), thenClose: true)
        }
        guard let resp = WebSocket.handshakeResponse(for: req) else {
            return send(HTTP.response(status: 400, reason: "Bad Request"), thenClose: true)
        }
        upgraded = true
        mapper = server.makeMapper()
        send(resp)
        sendText(helloMessage(displays: server.displayList))
        subscribed = [0]
        server.subscriptionsChanged(newlySubscribed: [0])
        processFrames()
    }

    private func serveStatic(_ req: HTTPRequest) {
        guard req.method == "GET", let path = HTTP.resolveStatic(root: server.webRoot, urlPath: req.path),
              let body = FileManager.default.contents(atPath: path) else {
            return send(HTTP.response(status: 404, reason: "Not Found", body: Data("not found".utf8)), thenClose: true)
        }
        send(HTTP.response(status: 200, reason: "OK", headers: HTTP.securityHeaders.merging(["Content-Type": HTTP.mimeType(for: path), "Cache-Control": "no-store", "Connection": "close"]) { $1 }, body: body), thenClose: true)
    }

    private func processFrames() {
        while true {
            switch WebSocket.parse(buffer) {
            case .incomplete: return
            case .invalid: return close()
            case let .frame(f, consumed):
                buffer.removeFirst(consumed)
                switch f.opcode {
                case .text: handleText(f.payload)
                case .ping: send(WebSocket.encode(opcode: .pong, payload: f.payload))
                case .close: send(WebSocket.encode(opcode: .close, payload: Data()), thenClose: true); return
                default: break
                }
            }
        }
    }

    private func handleText(_ data: Data) {
        guard let msg = ClientMessage.decode(data) else { return }
        if case let .subscribe(list) = msg {
            let valid = Set(list.filter { server.displayList.indices.contains($0) })
            subscribed = valid
            // every subscribe asks for a fresh keyframe, so a page that lost its decoder recovers on a static screen
            waitingForKey.formUnion(valid)
            server.subscriptionsChanged(newlySubscribed: Array(valid))
        } else {
            mapper?.handle(msg)
        }
    }

    func sendText(_ payload: Data) { send(WebSocket.encode(opcode: .text, payload: payload)) }

    /// Drops delta frames while the socket is backed up; a keyframe always goes out and resets the backlog.
    func sendVideo(_ wire: Data, display: Int, keyframe: Bool) {
        guard upgraded, !closed else { return }
        if waitingForKey.contains(display) && !keyframe { return }
        if pendingBytes > 4_000_000 && !keyframe { return }
        pendingBytes += wire.count
        if keyframe { waitingForKey.remove(display) }
        conn.send(content: wire, completion: .contentProcessed { [weak self] _ in self?.pendingBytes -= wire.count })
    }

    private func send(_ data: Data, thenClose: Bool = false) {
        conn.send(content: data, completion: .contentProcessed { [weak self] _ in if thenClose { self?.close() } })
    }
}
