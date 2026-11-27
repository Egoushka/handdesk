import Foundation

public enum LogLevel: Int, Comparable {
    case debug = 0, info, warn, error
    public static func < (a: LogLevel, b: LogLevel) -> Bool { a.rawValue < b.rawValue }
    public var name: String { ["debug", "info", "warn", "error"][rawValue] }
    public init?(name: String) {
        switch name { case "debug": self = .debug; case "info": self = .info; case "warn": self = .warn; case "error": self = .error; default: return nil }
    }
}

public protocol LogSink: AnyObject { func write(_ line: String) }

/// Keeps secrets and control characters out of log lines.
public enum LogScrub {
    /// Replaces the value of every `t=` query parameter (the pairing token) and any literal token.
    public static func secrets(_ s: String, token: String? = nil) -> String {
        var out = s
        if let token = token, token.count >= 8 { out = out.replacingOccurrences(of: token, with: "<token>") }
        var result = ""
        var rest = Substring(out)
        while let r = rest.range(of: "t=") {
            let before = rest[rest.startIndex..<r.lowerBound]
            // only a parameter name, not the tail of another word (e.g. "next=")
            let prev = before.last
            result += before
            if prev == nil || prev == "?" || prev == "&" || prev == " " {
                result += "t=<token>"
                var i = r.upperBound
                while i < rest.endIndex, !"& \"'\n".contains(rest[i]) { i = rest.index(after: i) }
                rest = rest[i...]
            } else {
                result += "t="
                rest = rest[r.upperBound...]
            }
        }
        return result + rest
    }

    /// Strips control characters, scrubs secrets, caps the length.
    public static func clean(_ s: String, max: Int = 256, token: String? = nil) -> String {
        let stripped = String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f && !(0x80...0x9f).contains($0.value) }))
        return String(secrets(stripped, token: token).prefix(max))
    }
}

/// JSON-lines logger: `{"event":..,"level":..,"ts":..,...fields}`. Thread safe; sinks and clock are injectable.
public final class Logger {
    public var level: LogLevel
    private let sinks: [LogSink]
    private let clock: () -> Date
    private let lock = NSLock()
    private var lastThrottled: [String: Date] = [:]
    private let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()

    public init(level: LogLevel = .info, sinks: [LogSink], clock: @escaping () -> Date = Date.init) {
        self.level = level; self.sinks = sinks; self.clock = clock
    }

    public func line(_ level: LogLevel, _ event: String, _ fields: [String: Any]) -> String {
        var obj: [String: Any] = fields.filter { JSONSerialization.isValidJSONObject([$0.value]) }
        obj["ts"] = formatter.string(from: clock()); obj["level"] = level.name; obj["event"] = event
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    public func log(_ level: LogLevel, _ event: String, _ fields: [String: Any] = [:]) {
        guard level >= self.level else { return }
        let l = line(level, event, fields)
        lock.lock(); defer { lock.unlock() }
        for s in sinks { s.write(l) }
    }

    public func debug(_ e: String, _ f: [String: Any] = [:]) { log(.debug, e, f) }
    public func info(_ e: String, _ f: [String: Any] = [:]) { log(.info, e, f) }
    public func warn(_ e: String, _ f: [String: Any] = [:]) { log(.warn, e, f) }

    /// Errors from per-frame paths: at most one line per `key` every `every` seconds.
    public func error(_ e: String, _ f: [String: Any] = [:], throttleKey: String? = nil, every: TimeInterval = 5) {
        if let k = throttleKey {
            let now = clock()
            lock.lock()
            if let last = lastThrottled[k], now.timeIntervalSince(last) < every { lock.unlock(); return }
            lastThrottled[k] = now
            lock.unlock()
        }
        log(.error, e, f)
    }
}

public final class StdoutSink: LogSink {
    public init() {}
    public func write(_ line: String) { FileHandle.standardOutput.write(Data((line + "\n").utf8)) }
}

/// Appends lines to a file; at `maxBytes` the file becomes `<path>.1` (the previous `.1` is dropped).
public final class FileLogSink: LogSink {
    private let path: String
    private let maxBytes: Int
    private var handle: FileHandle?
    private var size = 0

    public init(path: String, maxBytes: Int = 5 * 1024 * 1024) {
        self.path = path; self.maxBytes = maxBytes
    }

    private func open() {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        if !fm.fileExists(atPath: path) { fm.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600]) }
        handle = FileHandle(forWritingAtPath: path)
        size = Int((try? handle?.seekToEnd()) ?? 0)
    }

    private func rotate() {
        try? handle?.close(); handle = nil
        let fm = FileManager.default
        try? fm.removeItem(atPath: path + ".1")
        try? fm.moveItem(atPath: path, toPath: path + ".1")
        open()
    }

    public func write(_ line: String) {
        if handle == nil { open() }
        let data = Data((line + "\n").utf8)
        if size > 0 && size + data.count > maxBytes { rotate() }
        handle?.write(data)
        size += data.count
    }
}

/// At most `limit` events per one-second window.
public final class RateLimiter {
    private let limit: Int
    private let now: () -> TimeInterval
    private var windowStart: TimeInterval = -.infinity
    private var count = 0
    public init(limit: Int = 20, now: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 }) { self.limit = limit; self.now = now }
    public func allow() -> Bool {
        let t = now()
        if t - windowStart >= 1 { windowStart = t; count = 0 }
        count += 1
        return count <= limit
    }
}

public struct Permissions: Equatable {
    public var screenRecording: Bool
    public var accessibility: Bool
    public init(screenRecording: Bool, accessibility: Bool) { self.screenRecording = screenRecording; self.accessibility = accessibility }
}

public enum KeyClass {
    /// Coarse class of a DOM key code, so debug logs never record which keys were typed.
    public static func of(_ code: String) -> String {
        if code.hasPrefix("Key") || code.hasPrefix("Digit") { return "char" }
        if ["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight"].contains(code) { return "modifier" }
        if code.hasPrefix("Arrow") { return "nav" }
        if code.hasPrefix("F"), Int(code.dropFirst()) != nil { return "function" }
        return "other"
    }
}

extension ClientMessage {
    /// What a debug log line may say about a message: its type and sizes, never key identities or typed text.
    public var logFields: [String: Any] {
        switch self {
        case let .subscribe(l): return ["type": "subscribe", "displays": l]
        case .move: return ["type": "move"]
        case let .button(_, b, down, _, _): return ["type": "button", "button": b.rawValue, "down": down]
        case .scroll: return ["type": "scroll"]
        case .magnify: return ["type": "magnify"]
        case let .swipe(d): return ["type": "swipe", "direction": d.rawValue]
        case let .key(code, down, mods): return ["type": "key", "class": KeyClass.of(code), "down": down, "modifiers": mods.rawValue]
        case let .text(t): return ["type": "text", "length": t.utf16.count]
        case .ping: return ["type": "ping"]
        case let .log(level, m): return ["type": "log", "level": level.name, "length": m.count]
        case let .subscribeStreams(d, w): return ["type": "subscribe", "displays": d, "windows": w.count]
        case .moveWindow: return ["type": "move", "target": "window"]
        case let .buttonWindow(_, b, down, _, _): return ["type": "button", "target": "window", "button": b.rawValue, "down": down]
        case .windows: return ["type": "windows"]
        case let .virtualDisplay(a):
            switch a {
            case let .add(w, h, _): return ["type": "virtualDisplay", "action": "add", "width": w, "height": h]
            case let .remove(id): return ["type": "virtualDisplay", "action": "remove", "id": Int(id)]
            }
        case let .dimPhysical(on): return ["type": "dimPhysical", "on": on]
        case .apps: return ["type": "apps"]
        case let .app(action, bundleId): return ["type": "app", "action": action.rawValue, "bundleId": bundleId]
        case let .spotlight(q): return ["type": "spotlight", "length": q.utf16.count]
        case let .open(id): return ["type": "open", "id": id]
        }
    }
}
