import Foundation
import HandDeskCore

/// `handdesk cert issue|renew|status`: a dedicated single-name Let's Encrypt certificate for the Mac, by DNS-01 on Cloudflare.
/// The Cloudflare token is read from the homelab SOPS file with the Mac's no-prompt Secure Enclave key, held in this process's
/// memory, handed to lego through its environment and used for the DNS record calls. It is never printed, logged or written.
enum CertCommand {
    static let support = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/handdesk")
    static var dir: URL { support.appendingPathComponent("cert") }
    static var confURL: URL { support.appendingPathComponent("cert.conf") }
    static var p12URL: URL { support.appendingPathComponent("handdesk.p12") }
    static var passURL: URL { support.appendingPathComponent("handdesk.p12.pass") }
    static let lego = "/opt/homebrew/bin/lego"
    static let sops = "/opt/homebrew/bin/sops"
    static let openssl = "/usr/bin/openssl"

    static func expand(_ p: String) -> String { (p as NSString).expandingTildeInPath }

    static func loadConfig() -> Cert.Config? {
        guard let t = try? String(contentsOf: confURL, encoding: .utf8) else { return nil }
        return Cert.parseConfig(t)
    }

    /// Host name and p12 when a certificate is in place (used by `start` and `open`).
    static func active() -> (host: String, p12: String)? {
        guard FileManager.default.fileExists(atPath: p12URL.path), let c = loadConfig(), Cert.validHost(c.host) else { return nil }
        return (c.host, p12URL.path)
    }

    static func certificatePath(_ c: Cert.Config) -> String { dir.appendingPathComponent("certificates/\(c.host).crt").path }
    static func keyPath(_ c: Cert.Config) -> String { dir.appendingPathComponent("certificates/\(c.host).key").path }

    static func readToken(_ c: Cert.Config) -> String {
        guard FileManager.default.fileExists(atPath: expand(c.sopsFile)) else { fail("the SOPS file \(c.sopsFile) is not there (is the homelab checkout on this Mac?)") }
        let r = Shell.run(sops, Cert.sopsArguments(file: expand(c.sopsFile)), timeout: 60, environment: ["SOPS_AGE_KEY_FILE": expand(c.ageKeyFile), "PATH": "/opt/homebrew/bin:/usr/bin:/bin"]) // age-plugin-se lives in /opt/homebrew/bin
        guard r.status == 0, let token = Cert.dotenvValue("CF_DNS_API_TOKEN", in: r.output) else {
            fail("could not read the Cloudflare token from \(c.sopsFile) (sops exit \(r.status))") // never echo sops output
        }
        return token
    }

    // MARK: Cloudflare (token in a header, in this process only)

    static func cf(_ token: String, _ method: String, _ path: String, body: [String: Any]? = nil) -> [String: Any]? {
        var req = URLRequest(url: URL(string: "https://api.cloudflare.com/client/v4\(path)")!, timeoutInterval: 30)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body { req.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        let sem = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var out: [String: Any]?
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { out = j }
            sem.signal()
        }.resume()
        sem.wait()
        return out
    }

    /// Makes handdesk.<zone> an A record (DNS only) to this Mac's LAN address.
    static func ensureRecord(_ c: Cert.Config, token: String, ip: String) {
        guard Cert.isPrivateIPv4(ip) else { fail("not a private LAN address: \(ip)") }
        let zoneName = Cert.zoneName(host: c.host)
        guard let z = cf(token, "GET", "/zones?name=\(zoneName)"), (z["success"] as? Bool) == true,
              let zone = (z["result"] as? [[String: Any]])?.first, let zid = zone["id"] as? String else { fail("Cloudflare: cannot find the zone \(zoneName) with this token") }
        let list = cf(token, "GET", "/zones/\(zid)/dns_records?type=A&name=\(c.host)")
        let existing = ((list?["result"] as? [[String: Any]]) ?? []).compactMap { r -> (id: String, content: String)? in
            guard let id = r["id"] as? String, let content = r["content"] as? String else { return nil }
            return (id, content)
        }
        let body = Cert.recordBody(host: c.host, ip: ip)
        switch Cert.dnsAction(existing: existing, ip: ip) {
        case .none: print("dns: \(c.host) already points at \(ip)")
        case .create:
            guard (cf(token, "POST", "/zones/\(zid)/dns_records", body: body)?["success"] as? Bool) == true else { fail("Cloudflare: could not create the record") }
            log.info("cert", ["action": "dns_created", "host": c.host, "ip": ip])
            print("dns: created \(c.host) -> \(ip) (DNS only)")
        case let .update(id):
            guard (cf(token, "PUT", "/zones/\(zid)/dns_records/\(id)", body: body)?["success"] as? Bool) == true else { fail("Cloudflare: could not update the record") }
            log.info("cert", ["action": "dns_updated", "host": c.host, "ip": ip])
            print("dns: updated \(c.host) -> \(ip)")
        }
    }

    /// Asks public resolvers (not the API) whether the name answers with the Mac's address.
    static func resolvesPublicly(_ host: String, ip: String) -> Bool {
        ["1.1.1.1", "8.8.8.8"].contains { server in
            Cert.resolves(digOutput: Shell.run("/usr/bin/dig", ["+short", "+time=3", "+tries=1", host, "@\(server)"], timeout: 15).output, to: ip)
        }
    }

    /// The API can list a record that no resolver returns. Then delete and re-create it, and fail loudly if it still does not resolve.
    static func verifyRecord(_ c: Cert.Config, token: String, ip: String) {
        if resolvesPublicly(c.host, ip: ip) { print("dns: \(c.host) resolves to \(ip)"); return }
        print("dns: WARNING \(c.host) does not resolve to \(ip) in public DNS although the API lists it; re-creating the record")
        log.warn("cert", ["action": "dns_not_resolving", "host": c.host, "ip": ip])
        if let z = cf(token, "GET", "/zones?name=\(Cert.zoneName(host: c.host))"), let zid = ((z["result"] as? [[String: Any]])?.first)?["id"] as? String,
           let l = cf(token, "GET", "/zones/\(zid)/dns_records?type=A&name=\(c.host)") {
            for r in (l["result"] as? [[String: Any]]) ?? [] where (r["comment"] as? String)?.hasPrefix("handdesk:") == true {
                if let id = r["id"] as? String { _ = cf(token, "DELETE", "/zones/\(zid)/dns_records/\(id)") }
            }
        }
        ensureRecord(c, token: token, ip: ip)
        for _ in 0..<6 { if resolvesPublicly(c.host, ip: ip) { print("dns: \(c.host) resolves to \(ip)"); return }; Thread.sleep(forTimeInterval: 10) }
        fail("dns: \(c.host) still does not resolve to \(ip)")
    }

    static func lanIP() -> String? {
        var ifs: [(name: String, ip: String)] = []
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return nil }
        defer { freeifaddrs(head) }
        for p in sequence(first: first, next: { $0.pointee.ifa_next }) {
            guard let a = p.pointee.ifa_addr, a.pointee.sa_family == UInt8(AF_INET) else { continue }
            var buf = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(a, socklen_t(a.pointee.sa_len), &buf, socklen_t(buf.count), nil, 0, NI_NUMERICHOST) == 0 {
                ifs.append((String(cString: p.pointee.ifa_name), String(cString: buf)))
            }
        }
        return Cert.lanAddress(interfaces: ifs)
    }

    // MARK: certificate

    static func daysLeft(_ c: Cert.Config) -> Int? {
        let r = Shell.run(openssl, Cert.enddateArguments(certificate: certificatePath(c)))
        guard r.status == 0, let d = Cert.parseEnddate(r.output) else { return nil }
        return Cert.daysLeft(until: d)
    }

    static func buildP12(_ c: Cert.Config) {
        let fm = FileManager.default
        if !fm.fileExists(atPath: passURL.path) {
            var g = SystemRandomNumberGenerator()
            let pass = (0..<24).map { _ in String(format: "%02x", UInt8.random(in: 0...255, using: &g)) }.joined()
            fm.createFile(atPath: passURL.path, contents: Data(pass.utf8), attributes: [.posixPermissions: 0o600])
        }
        let tmp = p12URL.path + ".new"
        let r = Shell.run(openssl, Cert.p12Arguments(key: keyPath(c), certificate: certificatePath(c), output: tmp, passwordFile: passURL.path), timeout: 20)
        guard r.status == 0 else { fail("openssl could not build the p12 (exit \(r.status))") }
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmp)
        _ = try? fm.replaceItemAt(p12URL, withItemAt: URL(fileURLWithPath: tmp))
        try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: p12URL.path)
    }

    static func runLego(_ c: Cert.Config, token: String) {
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var env = Cert.legoEnvironment(config: c, directory: dir.path)
        env["CLOUDFLARE_DNS_API_TOKEN"] = token
        let r = Shell.run(lego, Cert.legoArguments, timeout: 300, environment: env)
        let lines = r.output.split(whereSeparator: \.isNewline).map(String.init)
        let bad = lines.filter { $0.contains("ERR") || $0.contains("FATA") || $0.lowercased().contains("error") || $0.contains("WARN") }
        let tail = (bad.isEmpty ? Array(lines.suffix(3)) : Array(bad.suffix(3))).joined(separator: " | ")
        guard r.status == 0 else { fail("lego failed (exit \(r.status)): \(LogScrub.clean(tail, max: 300))") }
        log.info("cert", ["action": "lego_ok", "host": c.host])
    }

    static func status() {
        guard let c = loadConfig() else { print("cert: not set up (run: handdesk cert issue --email you@example.com)"); return }
        let d = daysLeft(c)
        print("host: \(c.host)")
        print("certificate: \(d.map { "\($0) days left" } ?? "none")")
        print("p12: \(FileManager.default.fileExists(atPath: p12URL.path) ? "present" : "missing")")
        print("lan address: \(lanIP() ?? "unknown")")
        if let ip = lanIP() { print("dns: \(resolvesPublicly(c.host, ip: ip) ? "resolves in public DNS" : "DOES NOT resolve in public DNS (run: handdesk cert renew)")") }
        if let d, Cert.needsRenewal(daysLeft: d) { print("renewal: due") }
        if CommandLine.arguments.contains("--dns") {
            let token = readToken(c)
            if let z = cf(token, "GET", "/zones?name=\(Cert.zoneName(host: c.host))") {
                for r in (z["result"] as? [[String: Any]]) ?? [] { print("zone: \(r["name"] ?? "?") status=\(r["status"] ?? "?") ns=\(r["name_servers"] ?? "?")") }
            }
            if let z = cf(token, "GET", "/zones?name=\(Cert.zoneName(host: c.host))"), let zid = ((z["result"] as? [[String: Any]])?.first)?["id"] as? String,
               let l = cf(token, "GET", "/zones/\(zid)/dns_records?name.contains=lab.hrabovskyi&per_page=50") {
                for r in (l["result"] as? [[String: Any]]) ?? [] { print("record: \(r["type"] ?? "?") \(r["name"] ?? "?") -> \(r["content"] ?? "?") proxied=\(r["proxied"] ?? "?")") }
            }
        }
    }

    static func issue(_ args: [String]) {
        var c = loadConfig() ?? Cert.Config()
        var i = 0
        while i < args.count {
            switch args[i] {
            case "--email": i += 1; if i < args.count { c.email = args[i] }
            case "--host": i += 1; if i < args.count { c.host = args[i] }
            default: fail("cert issue [--email E] [--host NAME]")
            }
            i += 1
        }
        guard Cert.validHost(c.host) else { fail("bad host name") }
        guard Cert.validEmail(c.email) else { fail("an email for the Let's Encrypt account is needed: cert issue --email you@example.com") }
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try? Cert.serializeConfig(c).write(to: confURL, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: confURL.path)
        let token = readToken(c)
        guard let ip = lanIP() else { fail("no LAN address found") }
        ensureRecord(c, token: token, ip: ip)
        runLego(c, token: token)
        buildP12(c)
        print("cert: issued for \(c.host), \(daysLeft(c).map(String.init) ?? "?") days left; restart the agent to use it")
    }

    /// Renews when due, keeps the DNS record on the current address, restarts the agent when something changed.
    static func renew() {
        guard let c = loadConfig() else { fail("cert: not set up") }
        let token = readToken(c)
        if let ip = lanIP() { ensureRecord(c, token: token, ip: ip); verifyRecord(c, token: token, ip: ip) }
        var changed = false
        if let d = daysLeft(c), !Cert.needsRenewal(daysLeft: d), FileManager.default.fileExists(atPath: p12URL.path) {
            print("cert: \(d) days left, no renewal needed")
        } else {
            runLego(c, token: token)
            buildP12(c)
            changed = true
            print("cert: renewed")
        }
        if changed {
            let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
            p.arguments = ["kickstart", "-k", "gui/\(getuid())/\(LaunchAgentPlist.label)"]
            try? p.run(); p.waitUntilExit()
        }
    }

    /// Deletes the A record of a host this tool created earlier (for a name that turned out to be unusable).
    static func removeRecord(host: String) {
        guard let c = loadConfig(), Cert.validHost(host) else { fail("cert remove-record NAME (needs cert.conf)") }
        let token = readToken(c)
        guard let z = cf(token, "GET", "/zones?name=\(Cert.zoneName(host: host))"), let zid = ((z["result"] as? [[String: Any]])?.first)?["id"] as? String,
              let l = cf(token, "GET", "/zones/\(zid)/dns_records?type=A&name=\(host)") else { fail("Cloudflare: cannot read the zone") }
        for r in (l["result"] as? [[String: Any]]) ?? [] {
            guard let id = r["id"] as? String, (r["comment"] as? String)?.hasPrefix("handdesk:") == true else { print("skipped a record not made by handdesk"); continue }
            _ = cf(token, "DELETE", "/zones/\(zid)/dns_records/\(id)")
            print("removed \(host)")
        }
    }

    static func run(_ args: [String]) -> Never {
        switch args.first {
        case "remove-record": removeRecord(host: args.dropFirst().first ?? "")
        case "issue": issue(Array(args.dropFirst()))
        case "renew": renew()
        case "status": status()
        default: fail("cert issue [--email E] [--host NAME] | renew | status")
        }
        exit(0)
    }
}
