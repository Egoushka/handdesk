import Foundation
import HandDeskCore

final class MessageTests {
    func testDecodesEveryMessage() {
        XCTAssertEqual(json(#"{"type":"subscribe","displays":[0,1]}"#), .subscribe([0, 1]))
        XCTAssertEqual(json(#"{"type":"move","display":0,"x":0.5,"y":0.25}"#), .move(display: 0, x: 0.5, y: 0.25))
        XCTAssertEqual(json(#"{"type":"button","display":0,"button":"right","down":true,"x":0.1,"y":0.2}"#),
                       .button(display: 0, button: .right, down: true, x: 0.1, y: 0.2))
        XCTAssertEqual(json(#"{"type":"scroll","dx":1,"dy":-4.5}"#), .scroll(dx: 1, dy: -4.5))
        XCTAssertEqual(json(#"{"type":"magnify","delta":0.05}"#), .magnify(0.05))
        XCTAssertEqual(json(#"{"type":"swipe","direction":"up"}"#), .swipe(.up))
        XCTAssertEqual(json(#"{"type":"key","code":"KeyC","down":true,"modifiers":["cmd","shift"]}"#),
                       .key(code: "KeyC", down: true, modifiers: [.cmd, .shift]))
        XCTAssertEqual(json(#"{"type":"key","code":"Enter","down":false}"#), .key(code: "Enter", down: false, modifiers: []))
        XCTAssertEqual(json(#"{"type":"text","text":"привіт"}"#), .text("привіт"))
    }

    func testRejectsMalformed() {
        XCTAssertNil(json("not json"))
        XCTAssertNil(json(#"{"type":"nope"}"#))
        XCTAssertNil(json(#"{"type":"move","display":0,"x":"a","y":1}"#))
        XCTAssertNil(json(#"{"type":"button","display":0,"button":"middle","down":true,"x":0,"y":0}"#))
        XCTAssertNil(json(#"{"type":"button","display":0,"button":"left","down":1,"x":0,"y":0}"#))
        XCTAssertNil(json(#"{"type":"swipe","direction":"diagonal"}"#))
        XCTAssertNil(json(#"{"type":"key","code":"KeyA","down":true,"modifiers":["hyper"]}"#))
        XCTAssertNil(json(#"{"type":"text","text":""}"#))
        XCTAssertNil(json(#"{"type":"subscribe","displays":["a"]}"#))
    }

    func testModifierFlagBits() {
        XCTAssertEqual(Modifiers.cmd.cgFlagBits, 0x100000)
        XCTAssertEqual(Modifiers([.ctrl, .shift]).cgFlagBits, 0x60000)
        XCTAssertEqual(Modifiers([]).cgFlagBits, 0)
    }
}
