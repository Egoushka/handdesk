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
    /// the Mac's LAN address the TLS listener binds to (not 0.0.0.0)
    var lanAddress: String?
    var webRoot: String
    var token: String
    var magnifyMode: MagnifyMode = .keys
    var invertScroll = false
    var fps = 60
    var bitrate = 25_000_000
    var maxWidth = 2560
}

/// HTTP (static page) and WebSocket (/ws) on one port. All state lives on `queue`.
nonisolated(unsafe) var activeServer: Server?

final class Server {
    let queue = DispatchQueue(label: "handdesk.server")
    private let config: ServerConfig
    private var displays: [DisplayInfo]
    private let poster: EventPoster
    private var listeners: [NWListener] = []
    private var sessions: [ObjectIdentifier: Session] = [:]
    /// keyed by wire stream id: display index 0...127, window stream 128...255
    private var streams: [Int: DisplayStream] = [:]
    private var starting = Set<Int>()
    private var streamIds = StreamIds()
    private var windowsCache: [WindowInfo] = []
    private var appsCache: [AppInfo] = []
    private let system = RealSystem()
    private(set) lazy var mac = MacCommands(system: system, logger: log)
    private var pollTimer: DispatchSourceTimer?
    private var displayReload: DispatchWorkItem?

    init(config: ServerConfig, displays: [DisplayInfo], poster: EventPoster) {
        self.config = config; self.displays = displays; self.poster = poster
        mac.onDisplaysChanged = { [weak self] in self?.queue.async { self?.displayConfigurationChanged() } }
    }

    func start() throws {
        activeServer = self
        CGDisplayRegisterReconfigurationCallback({ _, _, _ in activeServer?.queue.async { activeServer?.displayConfigurationChanged() } }, nil)
        let port = NWEndpoint.Port(rawValue: config.port)!
        func listen(_ params: NWParameters, host: NWEndpoint.Host, label: String) throws {
            params.requiredLocalEndpoint = .hostPort(host: host, port: port)
            params.allowLocalEndpointReuse = true
            let l = try NWListener(using: params)
            l.newConnectionHandler = { [weak self] c in self?.accept(c) }
            l.stateUpdateHandler = { state in
                if case let .failed(e) = state { log.error("error", ["where": "listener", "which": label, "message": e.localizedDescription]); exit(1) }
            }
            l.start(queue: queue)
            listeners.append(l)
        }
        // plain http on loopback only: the Quest reaches it through adb reverse (a secure context)
        try listen(.tcp, host: .ipv4(.loopback), label: "loopback")
        if config.lan, let p12 = config.p12Path {
            // https on the Mac's LAN address only, with a publicly trusted certificate for config.host
            let tls = NWProtocolTLS.Options()
            sec_protocol_options_set_local_identity(tls.securityProtocolOptions, try Self.identity(p12Path: p12))
            let addr = config.lanAddress.flatMap { IPv4Address($0) }
            guard let addr else { throw NSError(domain: "handdesk", code: 4, userInfo: [NSLocalizedDescriptionKey: "no LAN address to bind to"]) }
            try listen(NWParameters(tls: tls), host: .ipv4(addr), label: "lan")
        }
    }

    static func identity(p12Path: String) throws -> sec_identity_t {
        let data = try Data(contentsOf: URL(fileURLWithPath: p12Path))
        let passFile = (try? String(contentsOfFile: p12Path + ".pass", encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        let pass = ProcessInfo.processInfo.environment["HANDDESK_P12_PASSWORD"] ?? passFile ?? ""
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
        let m = EventMapper(poster: poster, displays: displays, magnifyMode: config.magnifyMode, invertScroll: config.invertScroll)
        m.windows = windowsCache
        m.activator = { [system] pid in system.activate(pid: pid) }
        m.windowActivator = { [system] id, pid in system.raise(window: id, pid: pid) }
        return m
    }
    var token: String { config.token }
    var hostName: String? { config.lan ? config.host : nil }
    var webRoot: String { config.webRoot }
    var displayList: [DisplayInfo] { displays }

    func remove(_ s: Session) {
        sessions[ObjectIdentifier(s)] = nil
        refreshStreams()
        if sessions.isEmpty {
            // D25: nobody is watching, so no extra screens and a lit physical display
            mac.clientsGone()
            pollTimer?.cancel(); pollTimer = nil
        }
    }

    /// Restores the screen and removes virtual displays; called on SIGINT/SIGTERM before exit.
    func shutdown() { queue.sync { mac.clientsGone() } }

    func subscriptionsChanged(newlySubscribed: [Int]) {
        refreshStreams()
        for i in newlySubscribed { streams[i]?.requestKeyframe() }
    }

    /// `subscribe` with windows: allocates stream ids and tells the session what it got once each stream is running.
    func subscribeStreams(_ s: Session, displays list: [Int], windows: [UInt32]) {
        var ids = Set(list.filter { displays.indices.contains($0) })
        var accepted: [UInt32] = []
        for w in windows where windowsCache.contains(where: { $0.id == w }) {
            if let sid = streamIds.allocate(window: w) { ids.insert(sid); accepted.append(w) }
        }
        s.subscribed = ids
        s.subscribedWindows = accepted
        s.waitingForKey.formUnion(ids)
        log.info("subscribe", ["displays": list.filter { displays.indices.contains($0) }.sorted(), "windows": accepted.count])
        startPollingIfNeeded()
        subscriptionsChanged(newlySubscribed: Array(ids))
        let known = windowStreams(for: s)
        if !known.isEmpty { s.sendText(windowStreamsMessage(known)) }
    }

    private func windowStreams(for s: Session) -> [WindowStreamInfo] {
        s.subscribed.filter { $0 >= 128 }.sorted().compactMap { id in
            guard let ds = streams[id], let w = ds.window else { return nil }
            return WindowStreamInfo(windowId: w.id, stream: id, width: w.width, height: w.height, pixelWidth: ds.outWidth, pixelHeight: ds.outHeight)
        }
    }

    private func refreshStreams() {
        let wanted = Set(sessions.values.flatMap { $0.subscribed })
        for (i, s) in streams where !wanted.contains(i) {
            s.stop(); streams[i] = nil
            if let w = s.window { streamIds.free(window: w.id) }
        }
        for w in streamIds.windows {
            if let sid = streamIds.id(for: w), !wanted.contains(sid), streams[sid] == nil, !starting.contains(sid) { streamIds.free(window: w) }
        }
        for i in wanted where streams[i] == nil && !starting.contains(i) {
            let ds: DisplayStream
            if i < 128 {
                guard displays.indices.contains(i) else { continue }
                ds = DisplayStream(index: i, info: displays[i])
            } else {
                guard let wid = streamIds.window(for: i), let win = windowsCache.first(where: { $0.id == wid }) else { continue }
                ds = DisplayStream(index: i, window: win)
            }
            starting.insert(i)
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
                            if ds.window != nil {
                                for s in self.sessions.values where s.subscribed.contains(i) { s.sendText(windowStreamsMessage(self.windowStreams(for: s))) }
                            }
                        } else {
                            ds.stop() // everyone unsubscribed while it was starting
                        }
                        self.refreshStreams() // a subscription may have changed while this one started
                    }
                } catch {
                    queue.async {
                        self.starting.remove(i)
                        let hint = CGPreflightScreenCaptureAccess() ? "" : " (grant Screen Recording to the app that runs handdesk)"
                        log.error("error", ["where": "capture", "stream": i, "message": error.localizedDescription, "screenRecording": CGPreflightScreenCaptureAccess()])
                        for s in self.sessions.values where s.subscribed.contains(i) { s.sendText(errorMessage("capture failed: \(error.localizedDescription)\(hint)")) }
                    }
                }
            }
        }
    }

    // MARK: display configuration

    func displayConfigurationChanged() {
        displayReload?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.reloadDisplays() }
        displayReload = w
        queue.asyncAfter(deadline: .now() + 0.5, execute: w)
    }

    private func reloadDisplays() {
        let new = Displays.list()
        guard !new.isEmpty, new != displays else { return }
        displays = new
        log.info("displays_changed", ["count": new.count])
        // display indexes may now point at other screens: restart every display stream
        for (i, s) in streams where i < 128 { s.stop(); streams[i] = nil }
        for s in sessions.values { s.displaysChanged(new) }
        refreshStreams()
        for s in sessions.values { for i in s.subscribed where i < 128 { streams[i]?.requestKeyframe() } }
    }

    // MARK: windows and apps (polled while a page wants them)

    func sessionWantsMacLists() { startPollingIfNeeded() }

    private func startPollingIfNeeded() {
        guard pollTimer == nil else { return }
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: 1)
        t.setEventHandler { [weak self] in self?.pollMac() }
        t.resume()
        pollTimer = t
    }

    /// Fresh window list now, pushed to pages that asked for it.
    func refreshWindowsNow() { startPollingIfNeeded(); pollMac(force: true) }
    func refreshAppsNow() { startPollingIfNeeded(); pollMac(force: true) }

    private func pollMac(force: Bool = false) {
        let wantsWindows = sessions.values.contains { $0.wantsWindows || !$0.subscribedWindows.isEmpty }
        if wantsWindows {
            let now = system.listWindows()
            if now != windowsCache || force {
                let changed = now != windowsCache
                windowsCache = now
                for s in sessions.values { s.updateWindows(now) }
                if changed || force { for s in sessions.values where s.wantsWindows { s.sendText(windowsMessage(now)) } }
                reconcileWindowStreams()
            }
        }
        if sessions.values.contains(where: { $0.wantsApps }) {
            let apps = system.listApps()
            if apps != appsCache || force {
                appsCache = apps
                for s in sessions.values where s.wantsApps { s.sendText(appsMessage(apps)) }
            }
        }
    }

    /// Closed windows lose their stream; resized windows get a new encoder at the new size.
    private func reconcileWindowStreams() {
        for w in streamIds.windows {
            guard let sid = streamIds.id(for: w) else { continue }
            guard let info = windowsCache.first(where: { $0.id == w }) else {
                streams[sid]?.stop(); streams[sid] = nil
                streamIds.free(window: w)
                for s in sessions.values where s.subscribed.contains(sid) {
                    s.subscribed.remove(sid); s.subscribedWindows.removeAll { $0 == w }
                    s.sendText(windowStreamsMessage(windowStreams(for: s)))
                }
                log.info("window_closed", ["stream": sid])
                continue
            }
            if let running = streams[sid], let old = running.window, abs(old.width - info.width) >= 1 || abs(old.height - info.height) >= 1 {
                running.stop(); streams[sid] = nil
                log.debug("window_resized", ["stream": sid])
            }
        }
        refreshStreams()
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
    var subscribed: Set<Int> = []
    var subscribedWindows: [UInt32] = []
    var waitingForKey = Set<Int>()
    var wantsWindows = false
    var wantsApps = false
    private let spotlight = SpotlightStore()
    private var pendingBytes = 0
    private var closed = false
    private var deadline: DispatchWorkItem?
    private var openedAt: Date?
    private var remote = ""
    private let pageLogLimit = RateLimiter(limit: 20)

    init(connection: NWConnection, server: Server) { conn = connection; self.server = server }

    func start() {
        conn.stateUpdateHandler = { [weak self] st in
            switch st {
            case let .failed(e): self?.close("connection failed: \(e.localizedDescription)")
            case .cancelled: self?.close("connection cancelled")
            default: break
            }
        }
        conn.start(queue: server.queue)
        // a connection that has not finished the WebSocket upgrade within 10 s is dropped (slow clients, idle sockets)
        let d = DispatchWorkItem { [weak self] in if self?.upgraded == false { self?.close("no upgrade within 10 s") } }
        deadline = d
        server.queue.asyncAfter(deadline: .now() + 10, execute: d)
        receive()
    }

    private func close(_ reason: String = "closed") {
        guard !closed else { return }
        closed = true
        if let t = openedAt { log.info("session_close", ["reason": reason, "remote": remote, "seconds": Int(Date().timeIntervalSince(t))]) }
        deadline?.cancel()
        mapper?.releaseAll() // never leave a mouse button or modifier held after the session ends
        conn.cancel()
        server.remove(self)
    }

    private func receive() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, err in
            guard let self = self else { return }
            if let d = data, !d.isEmpty { self.buffer.append(d); self.process() }
            if let e = err { self.close("receive error: \(e.localizedDescription)") } else if done { self.close("peer closed") } else { self.receive() }
        }
    }

    private func process() {
        if !upgraded { processHTTP() } else { processFrames() }
    }

    private func processHTTP() {
        switch HTTP.parse(buffer) {
        case .incomplete: return
        case .malformed:
            log.debug("http", ["status": 400])
            send(HTTP.response(status: 400, reason: "Bad Request"), thenClose: true)
        case let .request(req, consumed):
            buffer.removeFirst(consumed)
            guard Auth.hostAllowed(host: req.headers["host"], extra: server.hostName) else {
                log.warn("rejected", ["why": "host", "host": LogScrub.clean(req.headers["host"] ?? "", max: 80)])
                return send(HTTP.response(status: 403, reason: "Forbidden"), thenClose: true)
            }
            if req.path == "/ws" { upgrade(req) } else { serveStatic(req) }
        }
    }

    private func upgrade(_ req: HTTPRequest) {
        guard Auth.authorizeWebSocket(req, token: server.token) else {
            log.warn("rejected", ["why": "auth", "path": LogScrub.secrets(req.path, token: server.token)])
            return send(HTTP.response(status: 403, reason: "Forbidden"), thenClose: true)
        }
        guard let resp = WebSocket.handshakeResponse(for: req) else {
            return send(HTTP.response(status: 400, reason: "Bad Request"), thenClose: true)
        }
        upgraded = true
        openedAt = Date()
        remote = LogScrub.clean("\(conn.endpoint)", max: 80)
        mapper = server.makeMapper()
        send(resp)
        sendText(helloMessage(displays: server.displayList, permissions: currentPermissions()))
        log.info("session_open", ["remote": remote, "displays": server.displayList.count])
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
            case .invalid: return close("invalid frame")
            case let .frame(f, consumed):
                buffer.removeFirst(consumed)
                switch f.opcode {
                case .text: handleText(f.payload)
                case .ping: send(WebSocket.encode(opcode: .pong, payload: f.payload))
                case .close: close(Adb.describeClose(f.payload)); send(WebSocket.encode(opcode: .close, payload: Data()), thenClose: true); return
                default: break
                }
            }
        }
    }

    private func handleText(_ data: Data) {
        guard let msg = ClientMessage.decode(data) else { log.debug("input", ["type": "invalid", "bytes": data.count]); return }
        log.debug("input", msg.logFields)
        if case let .ping(t) = msg {
            sendText(pongMessage(t: t))
        } else if case let .log(level, text) = msg {
            if pageLogLimit.allow() { log.log(level, "page", ["message": LogScrub.clean(text, token: server.token)]) }
        } else if case let .subscribeStreams(d, w) = msg {
            wantsWindows = true
            server.subscribeStreams(self, displays: d, windows: w)
        } else if case .windows = msg {
            wantsWindows = true
            server.refreshWindowsNow()
        } else if case .apps = msg {
            wantsApps = true
            server.refreshAppsNow()
        } else if server.mac.handle(msg, spotlight: spotlight, reply: { [weak self] data in self?.server.queue.async { self?.sendText(data) } }) {
            // launcher, virtual display and dimming requests are answered by MacCommands
        } else if case let .subscribe(list) = msg {
            let valid = Set(list.filter { server.displayList.indices.contains($0) })
            subscribed = valid
            subscribedWindows = []
            log.info("subscribe", ["displays": Array(valid).sorted()])
            // every subscribe asks for a fresh keyframe, so a page that lost its decoder recovers on a static screen
            waitingForKey.formUnion(valid)
            server.subscriptionsChanged(newlySubscribed: Array(valid))
        } else {
            mapper?.handle(msg)
        }
    }

    func updateWindows(_ w: [WindowInfo]) { mapper?.windows = w }
    func displaysChanged(_ d: [DisplayInfo]) {
        mapper?.displays = d
        subscribed = subscribed.filter { $0 >= 128 || d.indices.contains($0) }
        waitingForKey.formUnion(subscribed.filter { $0 < 128 })
        sendText(displaysMessage(d))
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
