import Foundation

public enum MouseButton: String, Equatable { case left, right }
public enum SwipeDirection: String, Equatable { case left, right, up, down }

public struct Modifiers: OptionSet, Equatable, Hashable {
    public let rawValue: Int
    public init(rawValue: Int) { self.rawValue = rawValue }
    public static let cmd = Modifiers(rawValue: 1)
    public static let ctrl = Modifiers(rawValue: 2)
    public static let alt = Modifiers(rawValue: 4)
    public static let shift = Modifiers(rawValue: 8)

    /// CGEventFlags raw bits (maskShift 0x20000, maskControl 0x40000, maskAlternate 0x80000, maskCommand 0x100000).
    public var cgFlagBits: UInt64 {
        var bits: UInt64 = 0
        if contains(.shift) { bits |= 0x20000 }
        if contains(.ctrl) { bits |= 0x40000 }
        if contains(.alt) { bits |= 0x80000 }
        if contains(.cmd) { bits |= 0x100000 }
        return bits
    }

    static func named(_ name: String) -> Modifiers? {
        switch name {
        case "cmd": return .cmd
        case "ctrl": return .ctrl
        case "alt": return .alt
        case "shift": return .shift
        default: return nil
        }
    }
}

/// Client-to-server input messages (JSON text frames, see docs/specs/handdesk-v0.1.md).
public enum ClientMessage: Equatable {
    case subscribe([Int])
    case move(display: Int, x: Double, y: Double)
    case button(display: Int, button: MouseButton, down: Bool, x: Double, y: Double)
    case scroll(dx: Double, dy: Double)
    case magnify(Double)
    case swipe(SwipeDirection)
    case key(code: String, down: Bool, modifiers: Modifiers)
    case text(String)
    /// Latency probe: the server answers `pong` with the same `t`.
    case ping(Double)
    /// A line from the page for the agent log (already stripped of control characters and capped).
    case log(level: LogLevel, message: String)
    /// `subscribe` with a `windows` list (v0.2): display indexes plus CGWindowIDs.
    case subscribeStreams(displays: [Int], windows: [UInt32])
    case moveWindow(window: UInt32, x: Double, y: Double)
    case buttonWindow(window: UInt32, button: MouseButton, down: Bool, x: Double, y: Double)
    case windows
    case raiseWindow(UInt32)
    case virtualDisplay(VirtualDisplayAction)
    case dimPhysical(Bool)
    case apps
    case app(action: AppAction, bundleId: String)
    case spotlight(String)
    case open(id: Int)

    public static let maxWindowSubscriptions = 16
    public static let maxQueryLength = 64

    public static func validBundleId(_ s: String) -> Bool {
        (1...128).contains(s.utf8.count) && s.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 46 || $0 == 45 }
    }

    public static func decode(_ data: Data) -> ClientMessage? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        func num(_ k: String) -> Double? { (obj[k] as? NSNumber).flatMap { $0 === kCFBooleanTrue || $0 === kCFBooleanFalse ? nil : $0.doubleValue } }
        func int(_ k: String) -> Int? { num(k).flatMap { $0.isFinite && abs($0) < 1e9 ? Int($0) : nil } }
        func fin(_ k: String) -> Double? { num(k).flatMap { $0.isFinite ? $0 : nil } }
        func windowId(_ k: String) -> UInt32? { num(k).flatMap { $0.isFinite && $0 >= 1 && $0 <= Double(UInt32.max) && $0 == $0.rounded() ? UInt32($0) : nil } }
        func bool(_ k: String) -> Bool? { (obj[k] as? NSNumber).flatMap { $0 === kCFBooleanTrue ? true : ($0 === kCFBooleanFalse ? false : nil) } }
        switch type {
        case "subscribe":
            let rawDisplays = (obj["displays"] as? [Any]) ?? (obj["windows"] == nil ? nil : [])
            guard let list = rawDisplays else { return nil }
            // display indexes are 0...127: 128...255 are window streams (D23)
            let ids = list.compactMap { ($0 as? NSNumber).flatMap { n -> Int? in let d = n.doubleValue; return d.isFinite && d >= 0 && d <= 127 ? Int(d) : nil } }
            guard ids.count == list.count, ids.count <= 64 else { return nil }
            guard let wl = obj["windows"] else { return .subscribe(ids) }
            guard let wlist = wl as? [Any], wlist.count <= maxWindowSubscriptions else { return nil }
            let wids = wlist.compactMap { ($0 as? NSNumber).flatMap { n -> UInt32? in let d = n.doubleValue; return d.isFinite && d >= 1 && d <= Double(UInt32.max) && d == d.rounded() ? UInt32(d) : nil } }
            guard wids.count == wlist.count else { return nil }
            return .subscribeStreams(displays: ids, windows: wids)
        case "move":
            if obj["window"] != nil {
                guard let w = windowId("window"), let x = fin("x"), let y = fin("y") else { return nil }
                return .moveWindow(window: w, x: x, y: y)
            }
            guard let d = int("display"), (0...255).contains(d), let x = fin("x"), let y = fin("y") else { return nil }
            return .move(display: d, x: x, y: y)
        case "button":
            if obj["window"] != nil {
                guard let w = windowId("window"), let b = (obj["button"] as? String).flatMap(MouseButton.init(rawValue:)),
                      let down = bool("down"), let x = fin("x"), let y = fin("y") else { return nil }
                return .buttonWindow(window: w, button: b, down: down, x: x, y: y)
            }
            guard let d = int("display"), let b = (obj["button"] as? String).flatMap(MouseButton.init(rawValue:)),
                  let down = bool("down"), (0...255).contains(d), let x = fin("x"), let y = fin("y") else { return nil }
            return .button(display: d, button: b, down: down, x: x, y: y)
        case "scroll":
            guard let dx = fin("dx"), let dy = fin("dy") else { return nil }
            return .scroll(dx: dx, dy: dy)
        case "magnify":
            guard let d = fin("delta") else { return nil }
            return .magnify(d)
        case "swipe":
            guard let d = (obj["direction"] as? String).flatMap(SwipeDirection.init(rawValue:)) else { return nil }
            return .swipe(d)
        case "key":
            guard let code = obj["code"] as? String, let down = bool("down") else { return nil }
            var mods: Modifiers = []
            if let names = obj["modifiers"] as? [Any] {
                for n in names {
                    guard let s = n as? String, let m = Modifiers.named(s) else { return nil }
                    mods.insert(m)
                }
            }
            return .key(code: code, down: down, modifiers: mods)
        case "text":
            guard let t = obj["text"] as? String, !t.isEmpty, t.utf16.count <= 256 else { return nil }
            return .text(t)
        case "ping":
            guard let t = fin("t") else { return nil }
            return .ping(t)
        case "log":
            guard let lv = (obj["level"] as? String).flatMap(LogLevel.init(name:)), lv <= .warn,
                  let m = obj["message"] as? String else { return nil }
            return .log(level: lv, message: LogScrub.clean(m, max: 256))
        case "windows":
            return .windows
        case "raise":
            guard let w = windowId("window") else { return nil }
            return .raiseWindow(w)
        case "virtualDisplay":
            switch obj["action"] as? String {
            case "add":
                guard let w = int("width"), let h = int("height"), (640...7680).contains(w), (480...4320).contains(h) else { return nil }
                let name = plain((obj["name"] as? String) ?? "handdesk", max: 32)
                return .virtualDisplay(.add(width: w, height: h, name: name.isEmpty ? "handdesk" : name))
            case "remove":
                guard let id = windowId("id") else { return nil }
                return .virtualDisplay(.remove(id: id))
            default: return nil
            }
        case "dimPhysical":
            guard let on = bool("on") else { return nil }
            return .dimPhysical(on)
        case "apps":
            return .apps
        case "app":
            guard let a = (obj["action"] as? String).flatMap(AppAction.init(rawValue:)), let id = obj["bundleId"] as? String, validBundleId(id) else { return nil }
            return .app(action: a, bundleId: id)
        case "spotlight":
            guard let q = obj["query"] as? String else { return nil }
            let clean = plain(q, max: maxQueryLength).trimmingCharacters(in: .whitespaces)
            guard !clean.isEmpty, q.utf16.count <= 1024 else { return nil }
            return .spotlight(clean)
        case "open":
            guard let id = int("id"), id >= 1 else { return nil }
            return .open(id: id)
        default:
            return nil
        }
    }
}
