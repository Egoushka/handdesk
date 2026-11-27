import Foundation

/// Launcher, virtual display and dimming requests from the page. Shared by all sessions (virtual displays belong to the agent, D25).
public final class MacCommands {
    public static let maxVirtualDisplays = 4
    private let system: SystemServices
    private let logger: Logger?
    public private(set) var ownedDisplays: Set<UInt32> = []
    public private(set) var dimmed = false
    /// Display configuration changed because of a request (the server also hears the OS notification).
    public var onDisplaysChanged: (() -> Void)?

    public init(system: SystemServices, logger: Logger? = nil) { self.system = system; self.logger = logger }

    /// Handles a message if it is one of ours. `reply` may be called later and from another queue.
    @discardableResult
    public func handle(_ message: ClientMessage, spotlight: SpotlightStore, reply: @escaping (Data) -> Void) -> Bool {
        switch message {
        case .windows:
            reply(windowsMessage(system.listWindows()))
        case .apps:
            reply(appsMessage(system.listApps()))
        case let .app(action, id):
            let ok: Bool
            switch action {
            case .launch: ok = system.launch(bundleId: id)
            case .activate: ok = system.activate(bundleId: id)
            case .quit: ok = system.quit(bundleId: id)
            }
            logger?.info("app", ["action": action.rawValue, "bundleId": id, "ok": ok])
        case let .spotlight(q):
            system.spotlight(query: q) { hits in
                reply(spotlightResultsMessage(query: q, results: spotlight.assign(hits)))
            }
        case let .open(id):
            if let path = spotlight.path(for: id) {
                let ok = system.openPath(path)
                logger?.info("open", ["id": id, "ok": ok])
            } else {
                logger?.warn("rejected", ["why": "unknown spotlight id", "id": id])
            }
        case let .virtualDisplay(action):
            switch action {
            case let .add(w, h, name):
                guard ownedDisplays.count < Self.maxVirtualDisplays else {
                    reply(virtualDisplayReply(ok: false, id: nil, error: "at most \(Self.maxVirtualDisplays) virtual displays"))
                    return true
                }
                switch system.createVirtualDisplay(width: w, height: h, name: name) {
                case let .success(id):
                    ownedDisplays.insert(id)
                    logger?.info("virtual_display", ["action": "add", "id": Int(id), "width": w, "height": h])
                    reply(virtualDisplayReply(ok: true, id: id, error: nil))
                    onDisplaysChanged?()
                case let .failure(e):
                    logger?.error("error", ["where": "virtual_display", "message": e.message])
                    reply(virtualDisplayReply(ok: false, id: nil, error: e.message))
                }
            case let .remove(id):
                guard ownedDisplays.contains(id) else {
                    reply(virtualDisplayReply(ok: false, id: id, error: "not a handdesk virtual display"))
                    return true
                }
                let ok = system.removeVirtualDisplay(id: id)
                if ok { ownedDisplays.remove(id) }
                logger?.info("virtual_display", ["action": "remove", "id": Int(id), "ok": ok])
                reply(virtualDisplayReply(ok: ok, id: id, error: ok ? nil : "could not remove"))
                if ok { onDisplaysChanged?() }
            }
        case let .dimPhysical(on):
            let ok = system.setDim(on)
            if ok { dimmed = on }
            logger?.info("dim_physical", ["on": on, "ok": ok])
            reply(dimReply(ok: ok))
        default:
            return false
        }
        return true
    }

    /// The last client left (or the agent is exiting): no extra screens and a lit physical display (D25).
    public func clientsGone() {
        if dimmed { _ = system.setDim(false); dimmed = false }
        let owned = ownedDisplays
        ownedDisplays = []
        for id in owned { _ = system.removeVirtualDisplay(id: id) }
        if !owned.isEmpty { logger?.info("virtual_display", ["action": "remove_all", "count": owned.count]); onDisplaysChanged?() }
    }
}
