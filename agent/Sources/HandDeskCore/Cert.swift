import Foundation

/// Pure parts of `handdesk cert`: configuration, command builders, parsing. Nothing here touches the network or a secret.
public enum Cert {
    public static let defaultHost = "handdesk.hrabovskyi.online" // not under *.lab: the home network rewrites every *.lab name to the tailnet address
    public static let renewBeforeDays = 30
    public static let renewLabel = "online.hrabovskyi.handdesk.cert"

    public struct Config: Equatable {
        public var host: String
        public var email: String
        /// SOPS file that holds CF_DNS_API_TOKEN, resolved against the homelab checkout
        public var sopsFile: String
        public var ageKeyFile: String
        public init(host: String = defaultHost, email: String = "", sopsFile: String = "~/Projects/personal/homelab/stacks/pangolin/.env.enc", ageKeyFile: String = "~/.config/age/se-noprompt-identity.txt") {
            self.host = host; self.email = email; self.sopsFile = sopsFile; self.ageKeyFile = ageKeyFile
        }
    }

    /// `key=value` lines; unknown keys and comments are ignored.
    public static func parseConfig(_ text: String) -> Config {
        var c = Config()
        for line in text.split(whereSeparator: \.isNewline) {
            let t = line.trimmingCharacters(in: .whitespaces)
            guard !t.hasPrefix("#"), let eq = t.firstIndex(of: "=") else { continue }
            let k = String(t[..<eq]).trimmingCharacters(in: .whitespaces)
            let v = String(t[t.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            switch k {
            case "host": c.host = v
            case "email": c.email = v
            case "sops": c.sopsFile = v
            case "agekey": c.ageKeyFile = v
            default: break
            }
        }
        return c
    }

    public static func serializeConfig(_ c: Config) -> String {
        "host=\(c.host)\nemail=\(c.email)\nsops=\(c.sopsFile)\nagekey=\(c.ageKeyFile)\n"
    }

    /// A DNS name that is safe to put in a certificate request and a file name.
    public static func validHost(_ h: String) -> Bool {
        let labels = h.split(separator: ".", omittingEmptySubsequences: false)
        return labels.count >= 3 && h.count <= 253 && labels.allSatisfy { l in
            !l.isEmpty && l.count <= 63 && l.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") } && !l.hasPrefix("-") && !l.hasSuffix("-")
        }
    }

    /// The zone is the last two labels (hrabovskyi.online); enough for this domain and its sub-domains.
    public static func zoneName(host: String) -> String { host.split(separator: ".").suffix(2).joined(separator: ".") }

    public static func validEmail(_ e: String) -> Bool { e.contains("@") && !e.contains(" ") && e.count <= 120 }

    /// Value of KEY in dotenv text (plain, single- or double-quoted), or nil.
    public static func dotenvValue(_ key: String, in text: String) -> String? {
        for line in text.split(whereSeparator: \.isNewline) {
            guard line.hasPrefix(key + "=") else { continue }
            var v = String(line.dropFirst(key.count + 1)).trimmingCharacters(in: .whitespaces)
            if v.count >= 2, let f = v.first, f == v.last, f == "\"" || f == "'" { v = String(v.dropFirst().dropLast()) }
            return v.isEmpty ? nil : v
        }
        return nil
    }

    /// Environment for lego without the Cloudflare token (the caller adds it for the one process).
    public static func legoEnvironment(config: Config, directory: String, renewDays: Int = renewBeforeDays) -> [String: String] {
        ["LEGO_PATH": directory, "LEGO_DNS": "cloudflare", "LEGO_EMAIL": config.email, "LEGO_DOMAINS": config.host,
         "LEGO_ACCEPT_TOS": "true", "LEGO_RENEW_DAYS": String(renewDays), "LEGO_NO_RANDOM_SLEEP": "true", "LEGO_KEY_TYPE": "RSA2048", "LEGO_DNS_RESOLVERS": "1.1.1.1:53,1.0.0.1:53", "LEGO_DNS_PROPAGATION_WAIT": "45s"]
    }

    public static let legoArguments = ["run"]

    public static func sopsArguments(file: String) -> [String] { ["-d", "--input-type", "dotenv", "--output-type", "dotenv", file] }

    /// openssl reads the key password from a file, so it never appears in the process list.
    public static func p12Arguments(key: String, certificate: String, output: String, passwordFile: String) -> [String] {
        ["pkcs12", "-export", "-inkey", key, "-in", certificate, "-out", output, "-name", "handdesk", "-passout", "file:\(passwordFile)"]
    }

    public static func enddateArguments(certificate: String) -> [String] { ["x509", "-enddate", "-noout", "-in", certificate] }

    /// `notAfter=Feb 25 12:00:00 2027 GMT`
    public static func parseEnddate(_ s: String) -> Date? {
        guard let eq = s.firstIndex(of: "=") else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "GMT")
        for fmt in ["MMM d HH:mm:ss yyyy zzz", "MMM  d HH:mm:ss yyyy zzz"] {
            f.dateFormat = fmt
            if let d = f.date(from: String(s[s.index(after: eq)...]).trimmingCharacters(in: .whitespacesAndNewlines)) { return d }
        }
        return nil
    }

    public static func daysLeft(until end: Date, now: Date = Date()) -> Int { Int((end.timeIntervalSince(now) / 86400).rounded(.down)) }
    public static func needsRenewal(daysLeft: Int) -> Bool { daysLeft < renewBeforeDays }

    // MARK: Cloudflare DNS

    public static func recordBody(host: String, ip: String) -> [String: Any] {
        ["type": "A", "name": host, "content": ip, "ttl": 120, "proxied": false, "comment": "handdesk: the Mac's LAN address (DNS only)"]
    }

    /// Dotted quad in a private range, which is the only thing this record may ever hold.
    public static func isPrivateIPv4(_ ip: String) -> Bool {
        let o = ip.split(separator: ".").compactMap { Int($0) }
        guard o.count == 4, o.allSatisfy({ (0...255).contains($0) }) else { return false }
        return o[0] == 10 || (o[0] == 172 && (16...31).contains(o[1])) || (o[0] == 192 && o[1] == 168)
    }

    /// What to do with the record, given what the zone returned (content of each existing A record, with its id).
    public enum DNSAction: Equatable { case none, create, update(id: String) }
    public static func dnsAction(existing: [(id: String, content: String)], ip: String) -> DNSAction {
        guard let first = existing.first else { return .create }
        return first.content == ip ? .none : .update(id: first.id)
    }

    /// Whether a real DNS query (`dig +short` output, one answer per line) returns the Mac's address. The Cloudflare API listing a
    /// record is not proof the name resolves, so `cert renew` and `status` check the answers themselves.
    public static func resolves(digOutput: String, to ip: String) -> Bool {
        digOutput.split(whereSeparator: \.isNewline).contains { $0.trimmingCharacters(in: .whitespaces) == ip }
    }

    // MARK: network interface choice

    /// The Mac's LAN address: prefer en0, then any other en* interface, private addresses only.
    public static func lanAddress(interfaces: [(name: String, ip: String)]) -> String? {
        let cands = interfaces.filter { $0.name.hasPrefix("en") && isPrivateIPv4($0.ip) }
        return (cands.first { $0.name == "en0" } ?? cands.first)?.ip
    }

    // MARK: renewal LaunchAgent

    /// Daily at 04:10: renews when fewer than 30 days are left and keeps the DNS record on the current address.
    public static func renewalPlist(executable: String, logPath: String) -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>\(renewLabel)</string>
            <key>ProgramArguments</key>
            <array>
                <string>\(LaunchAgentPlist.esc(executable))</string>
                <string>cert</string>
                <string>renew</string>
            </array>
            <key>StartCalendarInterval</key>
            <dict>
                <key>Hour</key>
                <integer>4</integer>
                <key>Minute</key>
                <integer>10</integer>
            </dict>
            <key>StandardOutPath</key>
            <string>\(LaunchAgentPlist.esc(logPath))</string>
            <key>StandardErrorPath</key>
            <string>\(LaunchAgentPlist.esc(logPath))</string>
        </dict>
        </plist>

        """
    }

    public static func pageURL(host: String, port: UInt16, token: String) -> String { "https://\(host):\(port)/?t=\(token)" }
}
