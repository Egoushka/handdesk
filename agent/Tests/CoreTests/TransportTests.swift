import Foundation
import HandDeskCore

final class TransportTests {
    func req(_ s: String) -> HTTPRequest {
        guard case let .request(r, _) = HTTP.parse(Data(s.utf8)) else { fatalError("parse") }
        return r
    }

    func testHTTPParse() {
        let raw = "GET /ws?t=abc&x=1 HTTP/1.1\r\nHost: localhost:8787\r\nOrigin: http://localhost:8787\r\n\r\nBODY"
        guard case let .request(r, consumed) = HTTP.parse(Data(raw.utf8)) else { return XCTFail() }
        XCTAssertEqual(r.method, "GET"); XCTAssertEqual(r.path, "/ws")
        XCTAssertEqual(r.query, ["t": "abc", "x": "1"]); XCTAssertEqual(r.headers["host"], "localhost:8787")
        XCTAssertEqual(consumed, raw.utf8.count - 4)
    }

    func testHTTPIncompleteAndMalformed() {
        XCTAssertEqual(HTTP.parse(Data("GET / HTTP/1.1\r\nHost: a".utf8)), .incomplete)
        XCTAssertEqual(HTTP.parse(Data("GARBAGE\r\n\r\n".utf8)), .malformed)
        XCTAssertEqual(HTTP.parse(Data("GET nothing HTTP/1.1\r\n\r\n".utf8)), .malformed)
        XCTAssertEqual(HTTP.parse(Data(repeating: 65, count: 20000)), .malformed)
    }

    func testResponseHasContentLength() {
        let s = String(data: HTTP.response(status: 404, reason: "Not Found", body: Data("no".utf8)), encoding: .utf8)!
        XCTAssertTrue(s.hasPrefix("HTTP/1.1 404 Not Found\r\n")); XCTAssertTrue(s.contains("Content-Length: 2")); XCTAssertTrue(s.hasSuffix("\r\n\r\nno"))
    }

    func testStaticResolveRejectsTraversal() {
        XCTAssertEqual(HTTP.resolveStatic(root: "/w", urlPath: "/"), "/w/index.html")
        XCTAssertEqual(HTTP.resolveStatic(root: "/w", urlPath: "/assets/a.js"), "/w/assets/a.js")
        XCTAssertNil(HTTP.resolveStatic(root: "/w", urlPath: "/../etc/passwd"))
        XCTAssertNil(HTTP.resolveStatic(root: "/w", urlPath: "/a/../../x"))
        XCTAssertNil(HTTP.resolveStatic(root: "/w", urlPath: "/a\\b"))
        XCTAssertEqual(HTTP.mimeType(for: "x/a.js"), "text/javascript; charset=utf-8")
    }

    func testTokenAndOrigin() {
        XCTAssertTrue(Auth.constantTimeEquals("abc", "abc"))
        XCTAssertFalse(Auth.constantTimeEquals("abc", "abd"))
        XCTAssertFalse(Auth.constantTimeEquals("abc", "abcd"))
        XCTAssertFalse(Auth.constantTimeEquals("", "a"))
        let ok = req("GET /ws?t=tok HTTP/1.1\r\nHost: localhost:8787\r\nOrigin: http://localhost:8787\r\n\r\n")
        XCTAssertTrue(Auth.authorizeWebSocket(ok, token: "tok"))
        XCTAssertFalse(Auth.authorizeWebSocket(ok, token: "other"))
        let cross = req("GET /ws?t=tok HTTP/1.1\r\nHost: localhost:8787\r\nOrigin: https://evil.example\r\n\r\n")
        XCTAssertFalse(Auth.authorizeWebSocket(cross, token: "tok"))
        let noToken = req("GET /ws HTTP/1.1\r\nHost: localhost:8787\r\n\r\n")
        XCTAssertFalse(Auth.authorizeWebSocket(noToken, token: "tok"))
        let noOrigin = req("GET /ws?t=tok HTTP/1.1\r\nHost: localhost:8787\r\n\r\n")
        XCTAssertTrue(Auth.authorizeWebSocket(noOrigin, token: "tok"))
    }

    func testAcceptKeyMatchesRFC6455Example() {
        XCTAssertEqual(WebSocket.acceptKey(for: "dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
    }

    func testHandshake() {
        let r = req("GET /ws HTTP/1.1\r\nHost: h\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
        let s = String(data: WebSocket.handshakeResponse(for: r)!, encoding: .utf8)!
        XCTAssertTrue(s.hasPrefix("HTTP/1.1 101")); XCTAssertTrue(s.contains("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="))
        XCTAssertNil(WebSocket.handshakeResponse(for: req("GET /ws HTTP/1.1\r\nHost: h\r\n\r\n")))
    }

    func testMaskedFrameRoundTripAllLengthClasses() {
        for n in [0, 5, 125, 126, 300, 65535, 65536, 100_000] {
            let payload = Data((0..<n).map { UInt8($0 % 251) })
            let wire = WebSocket.encodeMasked(opcode: .binary, payload: payload, mask: [9, 8, 7, 6])
            guard case let .frame(f, consumed) = WebSocket.parse(wire) else { return XCTFail("n=\(n)") }
            XCTAssertEqual(f.payload, payload); XCTAssertEqual(f.opcode, .binary); XCTAssertEqual(consumed, wire.count)
        }
    }

    func testParseIncompleteAndInvalid() {
        let wire = WebSocket.encodeMasked(opcode: .text, payload: Data("hello".utf8))
        XCTAssertEqual(WebSocket.parse(wire.prefix(1)), .incomplete)
        XCTAssertEqual(WebSocket.parse(wire.prefix(wire.count - 1)), .incomplete)
        XCTAssertEqual(WebSocket.parse(Data([0x81, 0x05, 1, 2, 3, 4, 0, 0, 0, 0, 0])), .invalid) // unmasked client frame
        XCTAssertEqual(WebSocket.parse(Data([0x01, 0x80, 1, 2, 3, 4])), .invalid) // fragment start
        XCTAssertEqual(WebSocket.parse(Data([0x80 | 0x0B, 0x80, 1, 2, 3, 4])), .invalid) // reserved opcode
        XCTAssertEqual(WebSocket.parse(Data([0x80 | 9, 0x80 | 126, 0, 200] + [1, 2, 3, 4])), .invalid) // oversized control frame
        let huge = Data([0x82, 0x80 | 127, 0, 0, 0, 0, 0xFF, 0, 0, 0, 1, 2, 3, 4])
        XCTAssertEqual(WebSocket.parse(huge), .invalid)
    }

    func testControlFramesAndServerEncoding() {
        guard case let .frame(ping, _) = WebSocket.parse(WebSocket.encodeMasked(opcode: .ping, payload: Data("x".utf8))) else { return XCTFail() }
        XCTAssertEqual(ping.opcode, .ping)
        XCTAssertEqual(WebSocket.encode(opcode: .pong, payload: Data("x".utf8)), Data([0x8A, 1, 0x78]))
        XCTAssertEqual(WebSocket.encode(opcode: .close, payload: Data()), Data([0x88, 0]))
        let big = WebSocket.encode(opcode: .binary, payload: Data(count: 300))
        XCTAssertEqual(Array(big.prefix(4)), [0x82, 126, 1, 44])
        let huge = WebSocket.encode(opcode: .binary, payload: Data(count: 70000))
        XCTAssertEqual(Array(huge.prefix(10)), [0x82, 127, 0, 0, 0, 0, 0, 1, 17, 112])
    }
}

final class VideoAndSupportTests {
    func testVideoHeader() {
        let m = VideoFrame.message(display: 2, keyframe: true, micros: 0x0102030405060708, annexB: Data([0, 0, 0, 1, 0x65]))
        XCTAssertEqual(Array(m.prefix(11)), [1, 2, 1, 1, 2, 3, 4, 5, 6, 7, 8])
        XCTAssertEqual(Array(m.suffix(5)), [0, 0, 0, 1, 0x65])
        XCTAssertEqual(VideoFrame.message(display: 0, keyframe: false, micros: 0, annexB: Data())[2], 0)
    }

    func testAnnexBConversion() {
        let avcc = Data([0, 0, 0, 2, 0x65, 0x88, 0, 0, 0, 1, 0x41])
        let sps = Data([0x67, 0x64]), pps = Data([0x68, 0xEE])
        XCTAssertEqual(AnnexB.convert(avcc: avcc), Data([0, 0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41]))
        XCTAssertEqual(AnnexB.convert(avcc: avcc, parameterSets: [sps, pps]),
                       Data([0, 0, 0, 1, 0x67, 0x64, 0, 0, 0, 1, 0x68, 0xEE, 0, 0, 0, 1, 0x65, 0x88, 0, 0, 0, 1, 0x41]))
        XCTAssertNil(AnnexB.convert(avcc: Data([0, 0, 0, 9, 1])))
        XCTAssertNil(AnnexB.convert(avcc: Data([0, 0])))
    }

    func testLaunchAgentPlist() {
        let p = LaunchAgentPlist.make(programArguments: ["/usr/local/bin/handdesk", "start", "--web", "/a&b"], logPath: "/tmp/h.log")
        XCTAssertTrue(p.contains("<string>online.hrabovskyi.handdesk</string>"))
        XCTAssertTrue(p.contains("<string>/a&amp;b</string>"))
        XCTAssertTrue(p.contains("<key>KeepAlive</key>"))
        XCTAssertNotNil(try? PropertyListSerialization.propertyList(from: Data(p.utf8), format: nil))
    }

    func testTokenGenerateAndStore() throws {
        let t = Token.generate()
        XCTAssertEqual(t.count, 32); XCTAssertNotEqual(t, Token.generate())
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("hd-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("token")
        let a = try Token.loadOrCreate(at: url), b = try Token.loadOrCreate(at: url)
        XCTAssertEqual(a, b)
        let perms = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int
        XCTAssertEqual(perms, 0o600)
    }

    func testHelloMessage() throws {
        let obj = try JSONSerialization.jsonObject(with: helloMessage(displays: [mainDisplay])) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "hello"); XCTAssertEqual(obj["version"] as? Int, 1)
        let d = (obj["displays"] as! [[String: Any]])[0]
        XCTAssertEqual(d["pixelWidth"] as? Int, 2000); XCTAssertEqual(d["width"] as? Double, 1000)
    }
}
