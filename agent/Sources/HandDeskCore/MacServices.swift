import Foundation
import CoreGraphics

// Window streams, virtual displays and the launcher (docs/specs/handdesk-v0.2.md). Everything here is pure: the OS sits behind `SystemServices`.

/// Control characters out, length capped. Not LogScrub: window titles and names are user data, not secrets.
func plain(_ s: String, max: Int) -> String {
    String(String.UnicodeScalarView(s.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7f && !(0x80...0x9f).contains($0.value) }).prefix(max))
}

public struct WindowInfo: Equatable {
    public var id: UInt32
    public var app: String
    public var pid: Int32
    public var title: String
    public var x: Double, y: Double, width: Double, height: Double
    public init(id: UInt32, app: String, pid: Int32, title: String, x: Double, y: Double, width: Double, height: Double) {
        self.id = id; self.app = app; self.pid = pid; self.title = title; self.x = x; self.y = y; self.width = width; self.height = height
    }

    /// Normalized (0..1, top-left origin) to global points inside this window's current bounds, clamped one point inside the edge.
    public func globalPoint(x nx: Double, y ny: Double) -> CGPoint {
        let cx = min(max(nx, 0), 1), cy = min(max(ny, 0), 1)
        return CGPoint(x: min(x + cx * width, x + width - 1), y: min(y + cy * height, y + height - 1))
    }

    public var json: [String: Any] {
        ["id": Int(id), "app": app, "pid": Int(pid), "title": title, "x": x, "y": y, "width": width, "height": height]
    }
}

/// One row of CGWindowListCopyWindowInfo, reduced to what the filter needs.
public struct RawWindow: Equatable {
    public var id: UInt32, pid: Int32, owner: String, title: String, layer: Int, onScreen: Bool
    public var x: Double, y: Double, width: Double, height: Double
    /// the owning app has a Dock icon (NSApplicationActivationPolicyRegular)
    public var regularApp: Bool
    public init(id: UInt32, pid: Int32, owner: String, title: String, layer: Int, onScreen: Bool,
                x: Double, y: Double, width: Double, height: Double, regularApp: Bool) {
        self.id = id; self.pid = pid; self.owner = owner; self.title = title; self.layer = layer; self.onScreen = onScreen
        self.x = x; self.y = y; self.width = width; self.height = height; self.regularApp = regularApp
    }
}

public enum WindowFilter {
    public static let minSize = 100.0
    /// Normal windows (layer 0, on screen, at least 100x100 points, regular apps, not ours).
    public static func filter(_ raw: [RawWindow], ownPID: Int32) -> [WindowInfo] {
        raw.filter { $0.layer == 0 && $0.onScreen && $0.regularApp && $0.pid != ownPID && $0.width >= minSize && $0.height >= minSize }
            .map { WindowInfo(id: $0.id, app: plain($0.owner, max: 64), pid: $0.pid, title: plain($0.title, max: 128),
                              x: $0.x, y: $0.y, width: $0.width, height: $0.height) }
    }
}

public struct AppInfo: Equatable {
    public var name: String, bundleId: String, pid: Int32, active: Bool
    public init(name: String, bundleId: String, pid: Int32, active: Bool) { self.name = name; self.bundleId = bundleId; self.pid = pid; self.active = active }
    public var json: [String: Any] { ["name": name, "bundleId": bundleId, "pid": Int(pid), "active": active] }
}

/// A Spotlight hit before an id is assigned.
public struct SpotlightHit: Equatable {
    public var name: String, kind: String, path: String
    public init(name: String, kind: String, path: String) { self.name = name; self.kind = kind; self.path = path }
}

/// Window stream ids are 128...255 (D23). Ids are reused after `free`.
public struct StreamIds {
    public static let range = 128...255
    private var byWindow: [UInt32: Int] = [:]
    public init() {}
    public func id(for window: UInt32) -> Int? { byWindow[window] }
    public func window(for stream: Int) -> UInt32? { byWindow.first { $0.value == stream }?.key }
    public mutating func allocate(window: UInt32) -> Int? {
        if let id = byWindow[window] { return id }
        let used = Set(byWindow.values)
        guard let id = Self.range.first(where: { !used.contains($0) }) else { return nil }
        byWindow[window] = id
        return id
    }
    public mutating func free(window: UInt32) { byWindow[window] = nil }
    public var windows: [UInt32] { Array(byWindow.keys) }
}

public struct WindowStreamInfo: Equatable {
    public var windowId: UInt32, stream: Int
    public var width: Double, height: Double
    public var pixelWidth: Int, pixelHeight: Int
    public init(windowId: UInt32, stream: Int, width: Double, height: Double, pixelWidth: Int, pixelHeight: Int) {
        self.windowId = windowId; self.stream = stream; self.width = width; self.height = height
        self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight
    }
    public var json: [String: Any] {
        ["windowId": Int(windowId), "stream": stream, "width": width, "height": height, "pixelWidth": pixelWidth, "pixelHeight": pixelHeight]
    }
}

/// The OS, as the launcher, window and virtual display code sees it. Production is `RealSystem`; tests use a fake.
public protocol SystemServices: AnyObject {
    func listWindows() -> [WindowInfo]
    func listApps() -> [AppInfo]
    func activate(pid: Int32)
    /// Brings one window to the front (raise it, then make its app frontmost).
    func raise(window: UInt32, pid: Int32)
    func launch(bundleId: String) -> Bool
    func activate(bundleId: String) -> Bool
    func quit(bundleId: String) -> Bool
    /// Calls `completion` once, on any queue.
    func spotlight(query: String, completion: @escaping ([SpotlightHit]) -> Void)
    func openPath(_ path: String) -> Bool
    func createVirtualDisplay(width: Int, height: Int, name: String) -> Result<UInt32, VirtualDisplayError>
    func removeVirtualDisplay(id: UInt32) -> Bool
    func setDim(_ on: Bool) -> Bool
}

public struct VirtualDisplayError: Error, Equatable {
    public var message: String
    public init(_ m: String) { message = m }
}

public enum VirtualDisplayAction: Equatable {
    case add(width: Int, height: Int, name: String)
    case remove(id: UInt32)
}

public enum AppAction: String, Equatable { case launch, activate, quit }

/// Per-session Spotlight answers: `open` works on ids this session was given, never on a path (D24).
public final class SpotlightStore {
    private var paths: [Int: String] = [:]
    private var next = 1
    public init() {}
    public func assign(_ hits: [SpotlightHit]) -> [(id: Int, hit: SpotlightHit)] {
        paths = [:]
        return hits.map { h in
            defer { next += 1 }
            paths[next] = h.path
            return (next, h)
        }
    }
    public func path(for id: Int) -> String? { paths[id] }
}

public enum SpotlightSearch {
    public static let limit = 12
    static let readCap = 400

    /// mdfind arguments (never a shell string). Applications by display name; the query is escaped for the metadata query language.
    public static func appArguments(query: String) -> [String] {
        let q = query.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return ["kMDItemContentTypeTree == 'com.apple.application-bundle'c && kMDItemDisplayName == \"*\(q)*\"cd"]
    }
    /// Everything else by file name; `-name` takes the query literally.
    public static func fileArguments(query: String) -> [String] { ["-name", query] }

    /// Apps first, then other files, no duplicates, at most 12.
    public static func rank(appPaths: [String], filePaths: [String]) -> [SpotlightHit] {
        var seen = Set<String>(), out: [SpotlightHit] = []
        for p in appPaths.prefix(readCap) where p.hasSuffix(".app") && seen.insert(p).inserted {
            out.append(SpotlightHit(name: name(of: p), kind: "app", path: p))
        }
        // apps in /Applications and /System/Applications before apps buried elsewhere
        out.sort { a, b in rankOf(a.path) < rankOf(b.path) }
        for p in filePaths.prefix(readCap) where !p.isEmpty && seen.insert(p).inserted {
            out.append(SpotlightHit(name: name(of: p), kind: p.hasSuffix(".app") ? "app" : "file", path: p))
        }
        return Array(out.prefix(limit))
    }
    private static func rankOf(_ p: String) -> Int { p.hasPrefix("/Applications/") ? 0 : p.hasPrefix("/System/Applications/") ? 1 : 2 }
    private static func name(of path: String) -> String {
        let n = (path as NSString).lastPathComponent
        return plain(n.hasSuffix(".app") ? String(n.dropLast(4)) : n, max: 80)
    }
}

// MARK: outgoing messages

private func data(_ obj: [String: Any]) -> Data { (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data() }

public func windowsMessage(_ windows: [WindowInfo]) -> Data { data(["type": "windows", "windows": windows.map(\.json)]) }
public func appsMessage(_ apps: [AppInfo]) -> Data { data(["type": "apps", "apps": apps.map(\.json)]) }
public func windowStreamsMessage(_ s: [WindowStreamInfo]) -> Data { data(["type": "windowStreams", "streams": s.map(\.json)]) }
public func displaysMessage(_ d: [DisplayInfo]) -> Data { data(["type": "displays", "displays": d.map(\.helloJSON)]) }
public func virtualDisplayReply(ok: Bool, id: UInt32?, error: String?) -> Data {
    var o: [String: Any] = ["type": "virtualDisplay", "ok": ok]
    if let id = id { o["id"] = Int(id) }
    if let e = error { o["error"] = plain(e, max: 160) }
    return data(o)
}
public func dimReply(ok: Bool) -> Data { data(["type": "dimPhysical", "ok": ok]) }
public func spotlightResultsMessage(query: String, results: [(id: Int, hit: SpotlightHit)]) -> Data {
    data(["type": "spotlightResults", "query": query,
          "results": results.map { ["id": $0.id, "name": $0.hit.name, "kind": $0.hit.kind, "path": $0.hit.path] as [String: Any] }])
}
