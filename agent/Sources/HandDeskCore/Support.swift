import Foundation

public enum LaunchAgentPlist {
    public static let label = "online.hrabovskyi.handdesk"

    static func esc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    /// `start` options for the plist. launchd runs with `/` as the working directory, so the page location is written as an absolute path.
    public static func arguments(executable: String, extra: [String], defaultWebRoot: String) -> [String] {
        var opts = extra
        if let i = opts.firstIndex(of: "--web"), i + 1 < opts.count {
            opts[i + 1] = absolute(opts[i + 1])
        } else {
            opts += ["--web", absolute(defaultWebRoot)]
        }
        return [executable, "start"] + opts
    }

    static func absolute(_ path: String) -> String {
        URL(fileURLWithPath: path).standardizedFileURL.path
    }

    public static func make(label: String = label, programArguments: [String], logPath: String) -> String {
        let args = programArguments.map { "        <string>\(esc($0))</string>" }.joined(separator: "\n")
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(esc(label))</string>
            <key>ProgramArguments</key>
            <array>
        \(args)
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>StandardOutPath</key>
            <string>\(esc(logPath))</string>
            <key>StandardErrorPath</key>
            <string>\(esc(logPath))</string>
        </dict>
        </plist>

        """
    }
}

public enum Token {
    public static func generate() -> String {
        var g = SystemRandomNumberGenerator()
        return (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &g)) }.joined()
    }

    /// The token is printed only by `start` (the one "Open on the Quest" line, which reaches the launchd log) and by `token`.
    /// Reads the pairing token, creating it (mode 0600) on first use.
    public static func loadOrCreate(at url: URL) throws -> String {
        let fm = FileManager.default
        if let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
            let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            if t.count >= 32 {
                try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
                return t
            }
        }
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let t = generate()
        guard fm.createFile(atPath: url.path, contents: Data(t.utf8), attributes: [.posixPermissions: 0o600]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        return t
    }
}


public enum TextChunks {
    /// Splits into pieces of at most `maxUnits` UTF-16 units without cutting a character (surrogate pair or combining cluster).
    public static func split(_ s: String, maxUnits: Int = 16) -> [[UInt16]] {
        var out: [[UInt16]] = []
        var cur: [UInt16] = []
        for ch in s {
            let u = Array(String(ch).utf16)
            if !cur.isEmpty && cur.count + u.count > maxUnits { out.append(cur); cur = [] }
            cur += u
            if cur.count >= maxUnits { out.append(cur); cur = [] }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }
}
