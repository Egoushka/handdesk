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

    public static func decode(_ data: Data) -> ClientMessage? {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        func num(_ k: String) -> Double? { (obj[k] as? NSNumber).flatMap { $0 === kCFBooleanTrue || $0 === kCFBooleanFalse ? nil : $0.doubleValue } }
        func int(_ k: String) -> Int? { num(k).flatMap { $0.isFinite ? Int($0) : nil } }
        func bool(_ k: String) -> Bool? { (obj[k] as? NSNumber).flatMap { $0 === kCFBooleanTrue ? true : ($0 === kCFBooleanFalse ? false : nil) } }
        switch type {
        case "subscribe":
            guard let list = obj["displays"] as? [Any] else { return nil }
            let ids = list.compactMap { ($0 as? NSNumber).map { Int(truncating: $0) } }
            guard ids.count == list.count else { return nil }
            return .subscribe(ids)
        case "move":
            guard let d = int("display"), let x = num("x"), let y = num("y"), x.isFinite, y.isFinite else { return nil }
            return .move(display: d, x: x, y: y)
        case "button":
            guard let d = int("display"), let b = (obj["button"] as? String).flatMap(MouseButton.init(rawValue:)),
                  let down = bool("down"), let x = num("x"), let y = num("y") else { return nil }
            return .button(display: d, button: b, down: down, x: x, y: y)
        case "scroll":
            guard let dx = num("dx"), let dy = num("dy") else { return nil }
            return .scroll(dx: dx, dy: dy)
        case "magnify":
            guard let d = num("delta") else { return nil }
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
        default:
            return nil
        }
    }
}
