import Foundation
import CoreGraphics
import HandDeskCore

final class HardeningTests {
    var poster = FakePoster()
    func make() -> EventMapper {
        poster = FakePoster()
        return EventMapper(poster: poster, displays: [mainDisplay, sideDisplay], now: { 100 })
    }

    func testReleaseAllLetsGoOfButtonAndModifiers() {
        let m = make()
        m.handle(json(#"{"type":"move","display":0,"x":0.5,"y":0.5}"#)!)
        m.handle(json(#"{"type":"button","display":0,"button":"left","down":true,"x":0.5,"y":0.5}"#)!)
        m.handle(json(#"{"type":"key","code":"MetaLeft","down":true}"#)!)
        m.handle(json(#"{"type":"key","code":"ShiftLeft","down":true}"#)!)
        poster.calls = []
        m.releaseAll()
        XCTAssertEqual(poster.calls.count, 3)
        XCTAssertEqual(poster.calls[0], .button(.left, false, CGPoint(x: 500, y: 250), 1))
        XCTAssertEqual(poster.calls[1], .flags(55, false, .shift))
        XCTAssertEqual(poster.calls[2], .flags(56, false, []))
        poster.calls = []
        m.releaseAll()
        XCTAssertEqual(poster.calls.count, 0, "nothing held, nothing posted")
    }

    func testMagnifyIsClampedAndCapped() {
        let m = make()
        m.handle(.magnify(1e300))
        XCTAssertEqual(poster.calls.count, 16, "8 taps, key down and up each")
        poster.calls = []
        m.handle(.magnify(-1e300))
        XCTAssertEqual(poster.calls.count, 16)
        poster.calls = []
        m.handle(.magnify(.infinity)); m.handle(.magnify(.nan))
        XCTAssertEqual(poster.calls.count, 0)
        let g = make()
        g.magnifyMode = .gesture
        g.handle(.magnify(50))
        XCTAssertEqual(poster.calls, [.magnify(1)])
    }

    func testScrollIsClamped() {
        let m = make()
        m.handle(.scroll(dx: 1e300, dy: -1e300))
        XCTAssertEqual(poster.calls, [.scroll(10000, -10000)])
        poster.calls = []
        m.handle(.scroll(dx: .nan, dy: 1))
        XCTAssertEqual(poster.calls.count, 0)
    }

    func testDecodeRejectsOutOfRangeAndNonFinite() {
        XCTAssertEqual(json(#"{"type":"move","display":1e300,"x":0.5,"y":0.5}"#), nil)
        XCTAssertEqual(json(#"{"type":"move","display":256,"x":0.5,"y":0.5}"#), nil)
        XCTAssertEqual(json(#"{"type":"move","display":-1,"x":0.5,"y":0.5}"#), nil)
        XCTAssertEqual(json(#"{"type":"move","display":0,"x":1e999,"y":0.5}"#), nil)
        XCTAssertEqual(json(#"{"type":"button","display":999,"button":"left","down":true,"x":0,"y":0}"#), nil)
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0,1e300]}"#), nil)
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0,300]}"#), nil)
        XCTAssertEqual(json(#"{"type":"scroll","dx":1e999,"dy":0}"#), nil)
        XCTAssertEqual(json(#"{"type":"magnify","delta":1e999}"#), nil)
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0,1]}"#), .subscribe([0, 1]))
    }

    func testTextChunksKeepCharactersWhole() {
        XCTAssertEqual(TextChunks.split("hello"), [Array("hello".utf16)])
        let long = String(repeating: "а", count: 40)
        let parts = TextChunks.split(long)
        XCTAssertEqual(parts.map { $0.count }, [16, 16, 8])
        let emoji = String(repeating: "😀", count: 9) // 2 units each
        let ep = TextChunks.split(emoji)
        XCTAssertTrue(ep.allSatisfy { $0.count <= 16 && $0.count % 2 == 0 })
        XCTAssertEqual(ep.flatMap { $0 }, Array(emoji.utf16))
        XCTAssertEqual(TextChunks.split("").count, 0)
    }

    func testLaunchAgentArgumentsCarryAbsoluteWebPath() {
        let a = LaunchAgentPlist.arguments(executable: "/x/handdesk", extra: ["--port", "9000"], defaultWebRoot: "/repo/web/dist")
        XCTAssertEqual(a, ["/x/handdesk", "start", "--port", "9000", "--web", "/repo/web/dist"])
        let b = LaunchAgentPlist.arguments(executable: "/x/handdesk", extra: ["--web", "/custom/dist"], defaultWebRoot: "/repo/web/dist")
        XCTAssertEqual(b, ["/x/handdesk", "start", "--web", "/custom/dist"])
        let c = LaunchAgentPlist.arguments(executable: "/x/handdesk", extra: [], defaultWebRoot: "/repo/agent/../web/dist")
        XCTAssertEqual(c.suffix(2), ["--web", "/repo/web/dist"])
        let rel = LaunchAgentPlist.arguments(executable: "/x/handdesk", extra: ["--web", "web/dist"], defaultWebRoot: "/z")
        XCTAssertTrue(rel.last!.hasPrefix("/"))
    }

    func testHostAllowlist() {
        XCTAssertTrue(Auth.hostAllowed(host: "localhost:8787"))
        XCTAssertTrue(Auth.hostAllowed(host: "127.0.0.1:8787"))
        XCTAssertTrue(Auth.hostAllowed(host: "[::1]:8787"))
        XCTAssertTrue(Auth.hostAllowed(host: "LocalHost"))
        XCTAssertFalse(Auth.hostAllowed(host: "evil.example:8787"))
        XCTAssertFalse(Auth.hostAllowed(host: "127.0.0.1.evil.example"))
        XCTAssertFalse(Auth.hostAllowed(host: nil))
        XCTAssertFalse(Auth.hostAllowed(host: "mac.lan"))
        XCTAssertTrue(Auth.hostAllowed(host: "mac.lan:8787", extra: "Mac.LAN"))
        XCTAssertFalse(Auth.hostAllowed(host: "other.lan", extra: "mac.lan"))
    }

    func testSecurityHeaders() {
        let h = HTTP.securityHeaders
        XCTAssertEqual(h["X-Content-Type-Options"], "nosniff")
        XCTAssertEqual(h["Referrer-Policy"], "no-referrer")
        XCTAssertTrue(h["Content-Security-Policy"]!.hasPrefix("default-src 'self'"))
    }

    func testExistingTokenFileIsTightenedTo0600() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hd-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("token")
        let t = Token.generate()
        try Data(t.utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
        try XCTAssertEqual(Token.loadOrCreate(at: url), t)
        try XCTAssertEqual(FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int, 0o600)
    }
}
