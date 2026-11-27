import Foundation

public struct HTTPRequest: Equatable {
    public var method: String
    public var path: String
    public var query: [String: String]
    public var headers: [String: String] // lowercased names
}

public enum HTTPParseResult: Equatable {
    case incomplete
    case malformed
    case request(HTTPRequest, consumed: Int)
}

public enum HTTP {
    public static let maxHeaderBytes = 16 * 1024

    public static func parse(_ data: Data) -> HTTPParseResult {
        let bytes = [UInt8](data)
        let terminator: [UInt8] = [13, 10, 13, 10]
        var end: Int?
        if bytes.count >= 4 {
            for i in 0...(bytes.count - 4) where Array(bytes[i..<i + 4]) == terminator { end = i; break }
        }
        guard let e = end else { return bytes.count > maxHeaderBytes ? .malformed : .incomplete }
        guard let head = String(bytes: bytes[0..<e], encoding: .utf8) else { return .malformed }
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines[0].split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 3, parts[2].hasPrefix("HTTP/1.") else { return .malformed }
        let target = String(parts[1])
        guard target.hasPrefix("/") else { return .malformed }
        var path = target
        var query: [String: String] = [:]
        if let q = target.firstIndex(of: "?") {
            path = String(target[..<q])
            var comps = URLComponents()
            comps.query = String(target[target.index(after: q)...])
            for item in comps.queryItems ?? [] { query[item.name] = item.value ?? "" }
        }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { return .malformed }
            headers[line[..<colon].lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        return .request(HTTPRequest(method: String(parts[0]), path: path.removingPercentEncoding ?? path, query: query, headers: headers), consumed: e + 4)
    }

    public static func response(status: Int, reason: String, headers: [String: String] = [:], body: Data = Data()) -> Data {
        var h = headers
        h["Content-Length"] = String(body.count)
        var out = "HTTP/1.1 \(status) \(reason)\r\n"
        for (k, v) in h.sorted(by: { $0.key < $1.key }) { out += "\(k): \(v)\r\n" }
        out += "\r\n"
        return Data(out.utf8) + body
    }

    public static func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "wasm": return "application/wasm"
        case "ogg": return "audio/ogg"
        case "wav": return "audio/wav"
        default: return "application/octet-stream"
        }
    }

    /// Maps a URL path to a file under `root`; nil when it would leave the root.
    public static func resolveStatic(root: String, urlPath: String) -> String? {
        var rel = urlPath
        if rel.hasSuffix("/") { rel += "index.html" }
        let comps = rel.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if comps.contains("..") || comps.contains(".") || comps.contains(where: { $0.contains("\0") || $0.contains("\\") }) { return nil }
        return (root as NSString).appendingPathComponent(comps.joined(separator: "/"))
    }
}

public extension HTTP {
    /// Added to every static response. The page uses an inline <style> and module scripts from its own origin.
    static let securityHeaders: [String: String] = [
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; media-src 'self' blob:",
    ]
}

/// Connection limits. Only WebSocket sessions are scarce: a page, a second tab and the browser's idle preconnects must not
/// push static asset requests over the limit (the headset then got the HTML but a reset on the JS, and the buttons did nothing).
public enum Admission {
    public static let maxSessions = 8
    public static let maxConnections = 64
    public static func acceptConnection(total: Int) -> Bool { total < maxConnections }
    public static func acceptUpgrade(upgraded: Int) -> Bool { upgraded < maxSessions }
}

public enum Auth {
    /// DNS-rebinding guard: only loopback names, plus the configured LAN name in --lan mode.
    public static func hostAllowed(host: String?, extra: String? = nil) -> Bool {
        guard var h = host?.lowercased(), !h.isEmpty else { return false }
        if h.hasPrefix("[") {
            guard let close = h.firstIndex(of: "]") else { return false }
            h = String(h[h.startIndex...close])
        } else if let colon = h.firstIndex(of: ":") {
            h = String(h[..<colon])
        }
        var allowed: Set<String> = ["localhost", "127.0.0.1", "[::1]"]
        if let e = extra?.lowercased(), !e.isEmpty { allowed.insert(e) }
        return allowed.contains(h)
    }

    public static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        var diff = x.count ^ y.count
        for i in 0..<max(x.count, y.count) { diff |= Int(i < x.count ? x[i] : 0) ^ Int(i < y.count ? y[i] : 0) }
        return diff == 0
    }

    /// A browser always sends Origin on a WebSocket; it must name the same host:port as Host.
    public static func originAllowed(origin: String?, host: String?) -> Bool {
        guard let origin = origin else { return true } // non-browser client; the token still gates it
        guard let host = host, let r = origin.range(of: "://") else { return false }
        return origin[r.upperBound...].lowercased() == host.lowercased()
    }

    public static func authorizeWebSocket(_ req: HTTPRequest, token: String) -> Bool {
        guard let t = req.query["t"], constantTimeEquals(t, token) else { return false }
        return originAllowed(origin: req.headers["origin"], host: req.headers["host"])
    }
}
