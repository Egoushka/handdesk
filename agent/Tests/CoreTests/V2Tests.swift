import Foundation
import HandDeskCore

final class CaptureSink: LogSink {
    var lines: [String] = []
    func write(_ line: String) { lines.append(line) }
}

final class V2Tests {
    func obj(_ s: String) -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] ?? [:] }

    func testLoggerWritesJsonLinesAndHonoursLevel() {
        let sink = CaptureSink()
        let l = Logger(level: .info, sinks: [sink], clock: { Date(timeIntervalSince1970: 0) })
        l.debug("nope"); l.info("session_open", ["displays": 2, "remote": "127.0.0.1:5"]); l.warn("w")
        XCTAssertEqual(sink.lines.count, 2)
        let o = obj(sink.lines[0])
        XCTAssertEqual(o["event"] as? String, "session_open"); XCTAssertEqual(o["level"] as? String, "info")
        XCTAssertEqual(o["displays"] as? Int, 2); XCTAssertTrue((o["ts"] as? String)?.hasPrefix("1970-01-01T00:00:00") ?? false)
        l.level = .debug; l.debug("dbg")
        XCTAssertEqual(sink.lines.count, 3)
    }

    func testFieldsCannotOverrideReservedKeys() {
        let l = Logger(sinks: [], clock: { Date(timeIntervalSince1970: 0) })
        let o = obj(l.line(.info, "real", ["event": "fake", "level": "fake"]))
        XCTAssertEqual(o["event"] as? String, "real"); XCTAssertEqual(o["level"] as? String, "info")
    }

    func testThrottledErrorsLogOncePerWindow() {
        var now = Date(timeIntervalSince1970: 0)
        let sink = CaptureSink()
        let l = Logger(sinks: [sink], clock: { now })
        l.error("e", [:], throttleKey: "k"); l.error("e", [:], throttleKey: "k")
        now = Date(timeIntervalSince1970: 6); l.error("e", [:], throttleKey: "k")
        l.error("e", [:], throttleKey: "other")
        XCTAssertEqual(sink.lines.count, 3)
    }

    func testFileSinkRotatesAtMaxBytesKeepingOneOldFile() throws {
        let dir = NSTemporaryDirectory() + "hd-log-\(UUID().uuidString)"
        let path = dir + "/handdesk.log"
        let sink = FileLogSink(path: path, maxBytes: 100)
        for i in 0..<10 { sink.write("line-\(i)-" + String(repeating: "x", count: 20)) }
        let fm = FileManager.default
        XCTAssertTrue(fm.fileExists(atPath: path)); XCTAssertTrue(fm.fileExists(atPath: path + ".1"))
        XCTAssertFalse(fm.fileExists(atPath: path + ".2"))
        let cur = try String(contentsOfFile: path, encoding: .utf8)
        XCTAssertTrue(cur.contains("line-9-"))
        XCTAssertTrue(cur.utf8.count <= 100)
        let attrs = try fm.attributesOfItem(atPath: path)
        XCTAssertEqual((attrs[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        try? fm.removeItem(atPath: dir)
    }

    func testScrubRemovesTokensAndControlCharacters() {
        XCTAssertEqual(LogScrub.secrets("/?t=abcdef0123456789&x=1"), "/?t=<token>&x=1")
        XCTAssertEqual(LogScrub.secrets("GET /ws?a=1&t=deadbeefdeadbeef HTTP/1.1"), "GET /ws?a=1&t=<token> HTTP/1.1")
        XCTAssertEqual(LogScrub.secrets("next=5"), "next=5")
        XCTAssertEqual(LogScrub.secrets("the secret is 0123456789abcdef0123456789abcdef ok", token: "0123456789abcdef0123456789abcdef"), "the secret is <token> ok")
        XCTAssertEqual(LogScrub.clean("a\u{0}b\nc\u{7}d"), "abcd")
        XCTAssertEqual(LogScrub.clean(String(repeating: "z", count: 400)).count, 256)
    }

    func testHelloCarriesVersion2AgentAndPermissions() throws {
        let o = try JSONSerialization.jsonObject(with: helloMessage(displays: [mainDisplay], permissions: Permissions(screenRecording: true, accessibility: false))) as! [String: Any]
        XCTAssertEqual(o["version"] as? Int, 2); XCTAssertEqual(o["agent"] as? String, "0.2.0")
        let p = o["permissions"] as! [String: Bool]
        XCTAssertEqual(p["screenRecording"], true); XCTAssertEqual(p["accessibility"], false)
    }

    func testPingDecodesAndPongEchoes() throws {
        XCTAssertEqual(ClientMessage.decode(Data(#"{"type":"ping","t":1234.5}"#.utf8)), .ping(1234.5))
        XCTAssertNil(ClientMessage.decode(Data(#"{"type":"ping"}"#.utf8)))
        XCTAssertNil(ClientMessage.decode(Data(#"{"type":"ping","t":"x"}"#.utf8)))
        XCTAssertNil(ClientMessage.decode(Data(#"{"type":"ping","t":1e999}"#.utf8)))
        let o = try JSONSerialization.jsonObject(with: pongMessage(t: 1234.5)) as! [String: Any]
        XCTAssertEqual(o["type"] as? String, "pong"); XCTAssertEqual(o["t"] as? Double, 1234.5)
    }

    func testPageLogMessagesAreCleanedAndLimited() {
        let long = String(repeating: "a", count: 400)
        guard case let .log(level, m)? = ClientMessage.decode(Data(#"{"type":"log","level":"warn","message":"x\u0000y\n\#(long)"}"#.utf8)) else { return XCTFail("decode") }
        XCTAssertEqual(level, .warn); XCTAssertEqual(m.count, 256); XCTAssertTrue(m.hasPrefix("xya"))
        XCTAssertNil(ClientMessage.decode(Data(#"{"type":"log","level":"error","message":"x"}"#.utf8)))
        XCTAssertNil(ClientMessage.decode(Data(#"{"type":"log","level":"info"}"#.utf8)))
        guard case let .log(_, scrubbed)? = ClientMessage.decode(Data(#"{"type":"log","level":"info","message":"url /?t=abcd1234abcd1234"}"#.utf8)) else { return XCTFail("decode") }
        XCTAssertEqual(scrubbed, "url /?t=<token>")
    }

    func testRateLimiterAllowsTwentyPerSecond() {
        var t = 100.0
        let r = RateLimiter(limit: 20, now: { t })
        XCTAssertEqual((0..<30).filter { _ in r.allow() }.count, 20)
        t += 1.1
        XCTAssertTrue(r.allow())
    }

    func testDebugFieldsNeverCarryKeysOrText() {
        let k = ClientMessage.key(code: "KeyQ", down: true, modifiers: [.cmd]).logFields
        XCTAssertEqual(k["class"] as? String, "char"); XCTAssertNil(k["code"])
        let t = ClientMessage.text("секрет").logFields
        XCTAssertEqual(t["length"] as? Int, 6); XCTAssertNil(t["text"])
        XCTAssertEqual(KeyClass.of("MetaLeft"), "modifier"); XCTAssertEqual(KeyClass.of("F12"), "function")
        XCTAssertEqual(KeyClass.of("Enter"), "other"); XCTAssertEqual(KeyClass.of("ArrowUp"), "nav")
        let l = Logger(level: .debug, sinks: [], clock: { Date(timeIntervalSince1970: 0) })
        XCTAssertFalse(l.line(.debug, "input", ClientMessage.text("секрет").logFields).contains("секрет"))
    }

    func testAdbDeviceParsingAndReverseDetection() {
        let out = "List of devices attached\n2G0YC5ZH6Q03N9\tdevice\n192.168.1.9:5555\tdevice\nXYZ\tunauthorized\nABC\toffline\n\n"
        XCTAssertEqual(Adb.parseDevices(out), ["2G0YC5ZH6Q03N9", "192.168.1.9:5555"])
        XCTAssertEqual(Adb.parseDevices("List of devices attached\n* daemon started\n"), [])
        XCTAssertTrue(Adb.isWifiSerial("192.168.1.9:5555")); XCTAssertFalse(Adb.isWifiSerial("2G0YC5ZH6Q03N9"))
        XCTAssertTrue(Adb.hasReverse("host-19 tcp:8787 tcp:8787\n", port: 8787))
        XCTAssertTrue(Adb.hasReverse("UsbFfs tcp:8787 tcp:8787", port: 8787))
        XCTAssertFalse(Adb.hasReverse("host-19 tcp:8788 tcp:8788\n", port: 8787))
        XCTAssertFalse(Adb.hasReverse("", port: 8787))
    }

    func testAdbArgumentBuilders() {
        XCTAssertEqual(Adb.reverseArgs(serial: "S", port: 8787), ["-s", "S", "reverse", "tcp:8787", "tcp:8787"])
        XCTAssertEqual(Adb.reverseListArgs(serial: "S"), ["-s", "S", "reverse", "--list"])
        XCTAssertEqual(Adb.tcpipArgs(serial: "S"), ["-s", "S", "tcpip", "5555"])
        XCTAssertEqual(Adb.connectArgs(address: "10.0.0.5"), ["connect", "10.0.0.5:5555"])
        XCTAssertEqual(Adb.wifiAddressArgs(serial: "S"), ["-s", "S", "shell", "ip", "-f", "inet", "addr", "show", "wlan0"])
        XCTAssertEqual(Adb.openArgs(serial: "S", url: "http://localhost:8787/?t=x"),
                       ["-s", "S", "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "http://localhost:8787/?t=x", "com.oculus.browser"])
        XCTAssertEqual(Adb.pageURL(port: 8787, token: "tok"), "http://localhost:8787/?t=tok")
    }

    func testWifiAddressParsing() {
        let out = "20: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP\n    inet 192.168.88.42/24 brd 192.168.88.255 scope global wlan0\n       valid_lft forever\n"
        XCTAssertEqual(Adb.parseWifiAddress(out), "192.168.88.42")
        XCTAssertNil(Adb.parseWifiAddress("Device \"wlan0\" does not exist."))
        XCTAssertNil(Adb.parseWifiAddress("inet 999.1.1.1/24"))
    }
}
