import Foundation
import HandDeskCore

final class CertTests {
    func testConfigRoundTripAndDefaults() {
        let c = Cert.Config(host: "handdesk.lab.example.org", email: "a@b.co")
        let back = Cert.parseConfig(Cert.serializeConfig(c))
        XCTAssertEqual(back, c)
        XCTAssertEqual(Cert.parseConfig("# c\nunknown=1\n").host, Cert.defaultHost)
    }

    func testHostAndEmailValidation() {
        XCTAssertTrue(Cert.validHost("handdesk.hrabovskyi.online"))
        XCTAssertFalse(Cert.validHost("localhost"))
        XCTAssertFalse(Cert.validHost("bad host.example.com"))
        XCTAssertFalse(Cert.validHost("-a.b.c"))
        XCTAssertFalse(Cert.validHost("a..b.c"))
        XCTAssertFalse(Cert.validHost("a.b.c;rm"))
        XCTAssertTrue(Cert.validEmail("x@y.zz"))
        XCTAssertFalse(Cert.validEmail("nope"))
        XCTAssertEqual(Cert.zoneName(host: "handdesk.hrabovskyi.online"), "hrabovskyi.online")
    }

    func testDotenvValue() {
        let t = "A=1\nCF_DNS_API_TOKEN=\"abc def\"\nB=2\n"
        XCTAssertEqual(Cert.dotenvValue("CF_DNS_API_TOKEN", in: t), "abc def")
        XCTAssertEqual(Cert.dotenvValue("A", in: t), "1")
        XCTAssertNil(Cert.dotenvValue("MISSING", in: t))
        XCTAssertNil(Cert.dotenvValue("C", in: "CF_DNS_API_TOKEN=x"))
    }

    func testLegoEnvironmentCarriesNoToken() {
        let env = Cert.legoEnvironment(config: Cert.Config(host: "h.a.b", email: "e@x.y"), directory: "/tmp/d")
        XCTAssertEqual(env["LEGO_DOMAINS"], "h.a.b")
        XCTAssertEqual(env["LEGO_DNS"], "cloudflare")
        XCTAssertEqual(env["LEGO_RENEW_DAYS"], "30")
        XCTAssertEqual(env["LEGO_DNS_RESOLVERS"], "1.1.1.1:53,1.0.0.1:53") // the Mac resolves through Tailscale, which cannot see the challenge record; the home network rewrites *.lab and IPv6 DNS checks time out, so lego waits 45 s instead of polling
        XCTAssertTrue(env.keys.allSatisfy { !$0.contains("TOKEN") && !$0.contains("CLOUDFLARE") && !$0.contains("CF_") })
        XCTAssertEqual(Cert.legoArguments, ["run"])
    }

    func testP12UsesAPasswordFileNeverTheValue() {
        let a = Cert.p12Arguments(key: "k", certificate: "c", output: "o", passwordFile: "/p")
        XCTAssertTrue(a.contains("file:/p"))
        XCTAssertFalse(a.contains("pass:"))
    }

    func testEnddateAndRenewalThreshold() {
        let d = Cert.parseEnddate("notAfter=Feb 25 12:00:00 2027 GMT\n")
        XCTAssertNotNil(d)
        let now = Cert.parseEnddate("notAfter=Feb  1 12:00:00 2027 GMT")!
        XCTAssertEqual(Cert.daysLeft(until: d!, now: now), 24)
        XCTAssertTrue(Cert.needsRenewal(daysLeft: 29))
        XCTAssertFalse(Cert.needsRenewal(daysLeft: 30))
        XCTAssertNil(Cert.parseEnddate("garbage"))
    }

    func testDnsRecordIsPrivateDnsOnlyAndActionsAreIdempotent() {
        let b = Cert.recordBody(host: "h.a.b", ip: "192.168.88.244")
        XCTAssertEqual(b["proxied"] as? Bool, false)
        XCTAssertEqual(b["type"] as? String, "A")
        XCTAssertTrue(Cert.isPrivateIPv4("192.168.88.244"))
        XCTAssertTrue(Cert.isPrivateIPv4("10.1.2.3"))
        XCTAssertTrue(Cert.isPrivateIPv4("172.20.0.1"))
        XCTAssertFalse(Cert.isPrivateIPv4("8.8.8.8"))
        XCTAssertFalse(Cert.isPrivateIPv4("172.32.0.1"))
        XCTAssertFalse(Cert.isPrivateIPv4("999.1.1.1"))
        XCTAssertEqual(Cert.dnsAction(existing: [], ip: "192.168.88.244"), .create)
        XCTAssertEqual(Cert.dnsAction(existing: [(id: "r1", content: "192.168.88.244")], ip: "192.168.88.244"), .none)
        XCTAssertEqual(Cert.dnsAction(existing: [(id: "r1", content: "192.168.88.9")], ip: "192.168.88.244"), .update(id: "r1"))
        XCTAssertTrue(Cert.resolves(digOutput: "192.168.88.244\n", to: "192.168.88.244"))
        XCTAssertFalse(Cert.resolves(digOutput: "", to: "192.168.88.244"))
        XCTAssertFalse(Cert.resolves(digOutput: "192.168.88.9\n", to: "192.168.88.244"))
    }

    func testLanAddressPrefersEn0AndSkipsPublicAndVirtual() {
        XCTAssertEqual(Cert.lanAddress(interfaces: [("lo0", "127.0.0.1"), ("en5", "192.168.1.5"), ("en0", "192.168.88.244")]), "192.168.88.244")
        XCTAssertEqual(Cert.lanAddress(interfaces: [("utun3", "10.0.0.2"), ("en5", "192.168.1.5")]), "192.168.1.5")
        XCTAssertNil(Cert.lanAddress(interfaces: [("en0", "8.8.4.4"), ("lo0", "127.0.0.1")]))
    }

    func testRenewalPlistRunsCertRenewDaily() {
        let p = Cert.renewalPlist(executable: "/x/handdesk", logPath: "/l.log")
        XCTAssertTrue(p.contains("<string>cert</string>"))
        XCTAssertTrue(p.contains("<string>renew</string>"))
        XCTAssertTrue(p.contains("StartCalendarInterval"))
        XCTAssertEqual(Cert.pageURL(host: "h.a.b", port: 8787, token: "t"), "https://h.a.b:8787/?t=t")
    }
}
