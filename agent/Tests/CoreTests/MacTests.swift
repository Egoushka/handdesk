import Foundation
import CoreGraphics
import HandDeskCore

final class FakeSystem: SystemServices {
    var windows: [WindowInfo] = []
    var apps: [AppInfo] = []
    var events: [String] = []
    var hits: [SpotlightHit] = []
    var createResult: Result<UInt32, VirtualDisplayError> = .success(77)
    var nextId: UInt32 = 77
    var removeOK = true
    func listWindows() -> [WindowInfo] { windows }
    func listApps() -> [AppInfo] { apps }
    func activate(pid: Int32) { events.append("activatePid \(pid)") }
    func raise(window: UInt32, pid: Int32) { events.append("raise \(window) \(pid)") }
    func launch(bundleId: String) -> Bool { events.append("launch \(bundleId)"); return true }
    func activate(bundleId: String) -> Bool { events.append("activate \(bundleId)"); return true }
    func quit(bundleId: String) -> Bool { events.append("quit \(bundleId)"); return true }
    func spotlight(query: String, completion: @escaping ([SpotlightHit]) -> Void) { events.append("spotlight \(query)"); completion(hits) }
    func openPath(_ path: String) -> Bool { events.append("open \(path)"); return true }
    func createVirtualDisplay(width: Int, height: Int, name: String) -> Result<UInt32, VirtualDisplayError> {
        events.append("create \(width)x\(height) \(name)")
        if case .success = createResult { defer { nextId += 1 }; return .success(nextId) }
        return createResult
    }
    func removeVirtualDisplay(id: UInt32) -> Bool { events.append("remove \(id)"); return removeOK }
    func setDim(_ on: Bool) -> Bool { events.append("dim \(on)"); return true }
}

let win = WindowInfo(id: 500, app: "Safari", pid: 321, title: "Docs", x: 100, y: 200, width: 400, height: 300)

final class MacTests {
    func obj(_ d: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] ?? [:] }

    // MARK: decoding

    func testSubscribeWithWindows() {
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0,1],"windows":[500,501]}"#), .subscribeStreams(displays: [0, 1], windows: [500, 501]))
        XCTAssertEqual(json(#"{"type":"subscribe","windows":[500]}"#), .subscribeStreams(displays: [], windows: [500]))
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0]}"#), .subscribe([0]))
        XCTAssertNil(json(#"{"type":"subscribe","displays":[128]}"#)) // 128+ are window streams
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":[0]}"#))
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":[-1]}"#))
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":[1.5]}"#))
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":[4294967296]}"#))
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":"x"}"#))
        let many = (1...17).map(String.init).joined(separator: ",")
        XCTAssertNil(json(#"{"type":"subscribe","displays":[0],"windows":[\#(many)]}"#))
    }

    func testWindowAddressedInput() {
        XCTAssertEqual(json(#"{"type":"move","window":500,"x":0.5,"y":0.25}"#), .moveWindow(window: 500, x: 0.5, y: 0.25))
        XCTAssertEqual(json(#"{"type":"button","window":500,"button":"right","down":true,"x":0,"y":1}"#),
                       .buttonWindow(window: 500, button: .right, down: true, x: 0, y: 1))
        XCTAssertNil(json(#"{"type":"move","window":0,"x":0,"y":0}"#))
        XCTAssertNil(json(#"{"type":"move","window":"a","x":0,"y":0}"#))
        XCTAssertNil(json(#"{"type":"button","window":5,"button":"middle","down":true,"x":0,"y":0}"#))
        XCTAssertNil(json(#"{"type":"move","window":5,"x":1e999,"y":0}"#))
        XCTAssertEqual(json(#"{"type":"move","display":0,"x":0.1,"y":0.2}"#), .move(display: 0, x: 0.1, y: 0.2))
    }

    func testVirtualDisplayDimAndLauncherMessages() {
        XCTAssertEqual(json(#"{"type":"windows"}"#), .windows)
        XCTAssertEqual(json(#"{"type":"apps"}"#), .apps)
        XCTAssertEqual(json(#"{"type":"virtualDisplay","action":"add","width":2560,"height":1440,"name":"desk"}"#), .virtualDisplay(.add(width: 2560, height: 1440, name: "desk")))
        XCTAssertEqual(json(#"{"type":"virtualDisplay","action":"add","width":640,"height":480}"#), .virtualDisplay(.add(width: 640, height: 480, name: "handdesk")))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"add","width":639,"height":480}"#))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"add","width":7681,"height":480}"#))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"add","width":800,"height":4321}"#))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"add","width":1e999,"height":480}"#))
        XCTAssertEqual(json(#"{"type":"virtualDisplay","action":"remove","id":77}"#), .virtualDisplay(.remove(id: 77)))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"remove"}"#))
        XCTAssertNil(json(#"{"type":"virtualDisplay","action":"explode"}"#))
        if case let .virtualDisplay(.add(_, _, name))? = json(#"{"type":"virtualDisplay","action":"add","width":800,"height":600,"name":"a\u0007bcdefghijklmnopqrstuvwxyz0123456789"}"#) {
            XCTAssertEqual(name.count, 32); XCTAssertFalse(name.contains("\u{07}"))
        } else { XCTFail("name should decode") }
        XCTAssertEqual(json(#"{"type":"dimPhysical","on":true}"#), .dimPhysical(true))
        XCTAssertNil(json(#"{"type":"dimPhysical","on":1}"#))
        XCTAssertEqual(json(#"{"type":"app","action":"launch","bundleId":"com.apple.Safari"}"#), .app(action: .launch, bundleId: "com.apple.Safari"))
        XCTAssertNil(json(#"{"type":"app","action":"launch","bundleId":"com apple"}"#))
        XCTAssertNil(json(#"{"type":"app","action":"launch","bundleId":"a;rm -rf"}"#))
        XCTAssertNil(json(#"{"type":"app","action":"launch","bundleId":""}"#))
        XCTAssertNil(json(#"{"type":"app","action":"delete","bundleId":"a.b"}"#))
        XCTAssertNil(json("{\"type\":\"app\",\"action\":\"quit\",\"bundleId\":\"" + String(repeating: "a", count: 129) + "\"}"))
        XCTAssertEqual(json(#"{"type":"open","id":3}"#), .open(id: 3))
        XCTAssertNil(json(#"{"type":"open","id":0}"#))
        XCTAssertNil(json(#"{"type":"open","path":"/etc/passwd"}"#))
    }

    func testSpotlightQueryIsCleanedAndCapped() {
        XCTAssertEqual(json(#"{"type":"spotlight","query":"saf"}"#), .spotlight("saf"))
        XCTAssertEqual(json(#"{"type":"spotlight","query":"  sa\u0000f\n "}"#), .spotlight("saf"))
        XCTAssertNil(json(#"{"type":"spotlight","query":"   "}"#))
        XCTAssertNil(json(#"{"type":"spotlight"}"#))
        if case let .spotlight(q)? = json("{\"type\":\"spotlight\",\"query\":\"" + String(repeating: "a", count: 100) + "\"}") { XCTAssertEqual(q.count, 64) } else { XCTFail("should decode") }
        XCTAssertNil(json("{\"type\":\"spotlight\",\"query\":\"" + String(repeating: "a", count: 2000) + "\"}"))
    }

    func testDebugFieldsOmitTitlesAndQueries() {
        let f = ClientMessage.spotlight("secret words").logFields
        XCTAssertEqual(f["length"] as? Int, 12)
        XCTAssertNil(f["query"])
        XCTAssertEqual(ClientMessage.open(id: 2).logFields["id"] as? Int, 2)
    }

    // MARK: window filter, geometry, stream ids

    func testWindowFilter() {
        func raw(_ id: UInt32, layer: Int = 0, on: Bool = true, regular: Bool = true, pid: Int32 = 10, w: Double = 400, h: Double = 300, title: String = "T") -> RawWindow {
            RawWindow(id: id, pid: pid, owner: "App", title: title, layer: layer, onScreen: on, x: 0, y: 0, width: w, height: h, regularApp: regular)
        }
        let out = WindowFilter.filter([raw(1), raw(2, layer: 25), raw(3, on: false), raw(4, regular: false), raw(5, pid: 99), raw(6, w: 99), raw(7, h: 99), raw(8, title: "a\u{07}b")], ownPID: 99)
        XCTAssertEqual(out.map(\.id), [1, 8])
        XCTAssertEqual(out[1].title, "ab")
        XCTAssertEqual(WindowFilter.filter([raw(9, w: 100, h: 100)], ownPID: 1).count, 1)
    }

    func testWindowGeometryClampsInsideTheWindow() {
        XCTAssertEqual(win.globalPoint(x: 0, y: 0), CGPoint(x: 100, y: 200))
        XCTAssertEqual(win.globalPoint(x: 0.5, y: 0.5), CGPoint(x: 300, y: 350))
        XCTAssertEqual(win.globalPoint(x: 1, y: 1), CGPoint(x: 499, y: 499))
        XCTAssertEqual(win.globalPoint(x: -3, y: 9), CGPoint(x: 100, y: 499))
    }

    func testStreamIdsAllocateReuseAndExhaust() {
        var ids = StreamIds()
        XCTAssertEqual(ids.allocate(window: 10), 128)
        XCTAssertEqual(ids.allocate(window: 11), 129)
        XCTAssertEqual(ids.allocate(window: 10), 128) // same window, same id
        XCTAssertEqual(ids.window(for: 129), 11)
        ids.free(window: 10)
        XCTAssertNil(ids.id(for: 10))
        XCTAssertEqual(ids.allocate(window: 12), 128) // freed id is reused
        for w in 100...300 { _ = ids.allocate(window: UInt32(w)) }
        XCTAssertNil(ids.allocate(window: 9999)) // 128 ids at most
        XCTAssertTrue(ids.windows.count == 128)
    }

    // MARK: input routing

    func testWindowInputActivatesTheAppThenClicksInsideTheWindow() {
        let poster = FakePoster()
        var order: [String] = []
        let m = EventMapper(poster: poster, displays: [mainDisplay], now: { 0 })
        m.windows = [win]
        m.activator = { pid in order.append("activate \(pid) after \(poster.calls.count) calls") }
        m.handle(.moveWindow(window: 500, x: 0.5, y: 0.5))
        m.handle(.buttonWindow(window: 500, button: .left, down: true, x: 0.5, y: 0.5))
        m.handle(.moveWindow(window: 500, x: 0.75, y: 0.5)) // drag while held
        m.handle(.buttonWindow(window: 500, button: .left, down: false, x: 0.75, y: 0.5))
        XCTAssertEqual(order, ["activate 321 after 1 calls"]) // before the press, not before the move, and not on release
        XCTAssertEqual(poster.calls, [
            .move(CGPoint(x: 300, y: 350)), .button(.left, true, CGPoint(x: 300, y: 350), 1),
            .drag(CGPoint(x: 400, y: 350), .left), .button(.left, false, CGPoint(x: 400, y: 350), 1),
        ])
    }

    func testRightButtonOnAWindowAlsoFocusesAndUnknownWindowsAreIgnored() {
        let poster = FakePoster()
        var activated: [Int32] = []
        let m = EventMapper(poster: poster, displays: [mainDisplay], now: { 0 })
        m.windows = [win]
        m.activator = { activated.append($0) }
        m.handle(.buttonWindow(window: 500, button: .right, down: true, x: 0.1, y: 0.1))
        m.handle(.buttonWindow(window: 404, button: .left, down: true, x: 0.1, y: 0.1))
        m.handle(.moveWindow(window: 404, x: 0.1, y: 0.1))
        XCTAssertEqual(activated, [321])
        XCTAssertEqual(poster.calls.count, 1)
    }

    func testWindowDoubleClickCountsLikeDisplayClicks() {
        let poster = FakePoster()
        var t = 0.0
        let m = EventMapper(poster: poster, displays: [mainDisplay], now: { t })
        m.windows = [win]
        for _ in 0..<2 {
            m.handle(.buttonWindow(window: 500, button: .left, down: true, x: 0.5, y: 0.5)); t += 0.1
            m.handle(.buttonWindow(window: 500, button: .left, down: false, x: 0.5, y: 0.5)); t += 0.1
        }
        XCTAssertEqual(poster.calls.compactMap { c -> Int? in if case let .button(_, true, _, n) = c { return n } else { return nil } }, [1, 2])
    }

    // MARK: commands

    func makeCommands() -> (MacCommands, FakeSystem, SpotlightStore, () -> [[String: Any]], (ClientMessage) -> Void) {
        let sys = FakeSystem()
        let cmds = MacCommands(system: sys)
        let store = SpotlightStore()
        var replies: [Data] = []
        let send: (ClientMessage) -> Void = { cmds.handle($0, spotlight: store, reply: { replies.append($0) }) }
        return (cmds, sys, store, { replies.map { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] ?? [:] } }, send)
    }

    func testWindowsAndAppsReplies() {
        let (_, sys, _, replies, send) = makeCommands()
        sys.windows = [win]
        sys.apps = [AppInfo(name: "Safari", bundleId: "com.apple.Safari", pid: 321, active: true)]
        send(.windows); send(.apps)
        let r = replies()
        XCTAssertEqual(r[0]["type"] as? String, "windows")
        XCTAssertEqual(((r[0]["windows"] as? [[String: Any]])?.first?["title"]) as? String, "Docs")
        XCTAssertEqual(r[1]["type"] as? String, "apps")
        XCTAssertEqual(((r[1]["apps"] as? [[String: Any]])?.first?["bundleId"]) as? String, "com.apple.Safari")
    }

    func testAppActionsGoToTheSystem() {
        let (_, sys, _, _, send) = makeCommands()
        send(.app(action: .launch, bundleId: "com.apple.Safari")); send(.app(action: .activate, bundleId: "a.b")); send(.app(action: .quit, bundleId: "a.b"))
        XCTAssertEqual(sys.events, ["launch com.apple.Safari", "activate a.b", "quit a.b"])
    }

    func testVirtualDisplayAddRemoveOnlyOwnDisplays() {
        let (cmds, sys, _, replies, send) = makeCommands()
        var changed = 0
        cmds.onDisplaysChanged = { changed += 1 }
        send(.virtualDisplay(.add(width: 1920, height: 1080, name: "desk")))
        XCTAssertEqual(replies()[0]["ok"] as? Bool, true); XCTAssertEqual(replies()[0]["id"] as? Int, 77)
        XCTAssertEqual(cmds.ownedDisplays, [77]); XCTAssertEqual(changed, 1)
        send(.virtualDisplay(.remove(id: 1))) // a physical display id
        XCTAssertEqual(replies()[1]["ok"] as? Bool, false)
        XCTAssertFalse(sys.events.contains("remove 1"))
        send(.virtualDisplay(.remove(id: 77)))
        XCTAssertEqual(replies()[2]["ok"] as? Bool, true); XCTAssertEqual(cmds.ownedDisplays, []); XCTAssertEqual(changed, 2)
    }

    func testVirtualDisplayUnavailableAndLimit() {
        let (cmds, sys, _, replies, send) = makeCommands()
        sys.createResult = .failure(VirtualDisplayError("unavailable: no private API"))
        send(.virtualDisplay(.add(width: 800, height: 600, name: "x")))
        XCTAssertEqual(replies()[0]["ok"] as? Bool, false)
        XCTAssertTrue((replies()[0]["error"] as? String ?? "").hasPrefix("unavailable"))
        XCTAssertEqual(cmds.ownedDisplays, [])
        sys.createResult = .success(1)
        for _ in 0..<5 { send(.virtualDisplay(.add(width: 800, height: 600, name: "x"))) }
        XCTAssertEqual(cmds.ownedDisplays.count, MacCommands.maxVirtualDisplays)
        XCTAssertEqual(replies().last?["ok"] as? Bool, false)
    }

    func testLastClientLeavingRemovesVirtualDisplaysAndRestoresBrightness() {
        let (cmds, sys, _, replies, send) = makeCommands()
        send(.virtualDisplay(.add(width: 800, height: 600, name: "a"))); send(.virtualDisplay(.add(width: 800, height: 600, name: "b")))
        send(.dimPhysical(true))
        XCTAssertEqual(replies().last?["type"] as? String, "dimPhysical"); XCTAssertTrue(cmds.dimmed)
        sys.events = []
        cmds.clientsGone()
        XCTAssertEqual(Set(sys.events), ["dim false", "remove 77", "remove 78"])
        XCTAssertEqual(cmds.ownedDisplays, []); XCTAssertFalse(cmds.dimmed)
        sys.events = []
        cmds.clientsGone() // idempotent: nothing left to undo
        XCTAssertEqual(sys.events, [])
    }

    func testSpotlightResultsAreOpenedByIdNeverByPath() {
        let (_, sys, store, replies, send) = makeCommands()
        sys.hits = [SpotlightHit(name: "Safari", kind: "app", path: "/Applications/Safari.app"), SpotlightHit(name: "notes", kind: "file", path: "/Users/y/notes.txt")]
        send(.spotlight("saf"))
        let results = (replies()[0]["results"] as? [[String: Any]]) ?? []
        XCTAssertEqual(results.map { $0["id"] as? Int }, [1, 2])
        XCTAssertEqual(store.path(for: 2), "/Users/y/notes.txt")
        send(.open(id: 1))
        send(.open(id: 99)) // never returned to this session
        send(.open(id: 0))
        XCTAssertEqual(sys.events.filter { $0.hasPrefix("open ") }, ["open /Applications/Safari.app"])
        send(.spotlight("again")) // a new answer replaces the old ids
        XCTAssertNil(store.path(for: 99))
        send(.open(id: 1)) // an id from the replaced answer is dead
        XCTAssertEqual(sys.events.filter { $0.hasPrefix("open ") }.count, 1)
        send(.open(id: 3)) // ids keep counting up, so the new answer starts at 3
        XCTAssertEqual(sys.events.filter { $0.hasPrefix("open ") }.count, 2)
    }

    func testRaiseDecodesAndBringsOneWindowForward() {
        XCTAssertEqual(json(#"{"type":"raise","window":500}"#), .raiseWindow(500))
        XCTAssertNil(json(#"{"type":"raise","window":0}"#))
        XCTAssertNil(json(#"{"type":"raise"}"#))
        let (_, sys, _, _, send) = makeCommands()
        sys.windows = [win]
        send(.raiseWindow(500))
        send(.raiseWindow(404)) // not in the list: nothing happens
        XCTAssertEqual(sys.events, ["raise 500 321"])
    }

    func testWindowActivatorBeatsAppActivator() {
        let poster = FakePoster()
        var got: [String] = []
        let m = EventMapper(poster: poster, displays: [mainDisplay], now: { 0 })
        m.windows = [win]
        m.activator = { _ in got.append("app") }
        m.windowActivator = { id, pid in got.append("window \(id) \(pid)") }
        m.handle(.buttonWindow(window: 500, button: .left, down: true, x: 0.5, y: 0.5))
        XCTAssertEqual(got, ["window 500 321"])
    }

    func testOtherMessagesAreNotHandled() {
        let (_, _, _, _, _) = makeCommands()
        let cmds = MacCommands(system: FakeSystem())
        XCTAssertFalse(cmds.handle(.ping(1), spotlight: SpotlightStore(), reply: { _ in }))
        XCTAssertFalse(cmds.handle(.scroll(dx: 1, dy: 1), spotlight: SpotlightStore(), reply: { _ in }))
    }

    // MARK: spotlight search

    func testMdfindArgumentsAreAnArrayAndEscaped() {
        XCTAssertEqual(SpotlightSearch.fileArguments(query: "a b; rm -rf /"), ["-name", "a b; rm -rf /"]) // one argument, no shell
        let a = SpotlightSearch.appArguments(query: #"x" || kMDItemKind == "*"#)
        XCTAssertEqual(a.count, 1)
        XCTAssertTrue(a[0].contains(#"\" || kMDItemKind == \""#)) // quotes cannot end the string literal
        XCTAssertTrue(a[0].hasSuffix(#"*"cd"#))
        XCTAssertTrue(SpotlightSearch.appArguments(query: #"a\b"#)[0].contains(#"a\\b"#))
    }

    func testSpotlightRankAppsFirstDedupedAndCapped() {
        let apps = ["/Users/y/dl/Safari Copy.app", "/System/Applications/Notes.app", "/Applications/Safari.app", "/Applications/Safari.app", "/Applications/readme.txt"]
        let files = ["/Applications/Safari.app", "/Users/y/safari.txt"] + (1...20).map { "/tmp/f\($0).txt" }
        let hits = SpotlightSearch.rank(appPaths: apps, filePaths: files)
        XCTAssertEqual(hits.count, 12)
        XCTAssertEqual(hits.prefix(4).map(\.path), ["/Applications/Safari.app", "/System/Applications/Notes.app", "/Users/y/dl/Safari Copy.app", "/Users/y/safari.txt"])
        XCTAssertEqual(hits[0].name, "Safari"); XCTAssertEqual(hits[0].kind, "app"); XCTAssertEqual(hits[3].kind, "file")
        XCTAssertEqual(Set(hits.map(\.path)).count, hits.count)
    }

    // MARK: outgoing JSON

    func testOutgoingMessages() {
        let s = obj(windowStreamsMessage([WindowStreamInfo(windowId: 500, stream: 128, width: 400, height: 300, pixelWidth: 800, pixelHeight: 600)]))
        XCTAssertEqual(s["type"] as? String, "windowStreams")
        let first = (s["streams"] as? [[String: Any]])?.first
        XCTAssertEqual(first?["windowId"] as? Int, 500); XCTAssertEqual(first?["stream"] as? Int, 128); XCTAssertEqual(first?["pixelWidth"] as? Int, 800)
        let d = obj(displaysMessage([mainDisplay]))
        XCTAssertEqual(d["type"] as? String, "displays"); XCTAssertEqual((d["displays"] as? [Any])?.count, 1)
        let v = obj(virtualDisplayReply(ok: false, id: nil, error: "unavailable: x"))
        XCTAssertEqual(v["ok"] as? Bool, false); XCTAssertNil(v["id"])
        XCTAssertEqual(obj(dimReply(ok: true))["type"] as? String, "dimPhysical")
        let w = obj(windowsMessage([win]))
        XCTAssertEqual(((w["windows"] as? [[String: Any]])?.first?["app"]) as? String, "Safari")
    }
}
