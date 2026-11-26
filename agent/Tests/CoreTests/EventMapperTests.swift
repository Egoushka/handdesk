import Foundation
import CoreGraphics
import HandDeskCore

final class EventMapperTests {
    var poster = FakePoster()
    var clock = 100.0
    func make(mode: MagnifyMode = .keys, invert: Bool = false) -> EventMapper {
        poster = FakePoster()
        return EventMapper(poster: poster, displays: [mainDisplay, sideDisplay], magnifyMode: mode, invertScroll: invert, now: { self.clock })
    }

    func testGeometryClampsAndOffsets() {
        XCTAssertEqual(mainDisplay.globalPoint(x: 0.5, y: 0.5), CGPoint(x: 500, y: 250))
        XCTAssertEqual(mainDisplay.globalPoint(x: -1, y: 2), CGPoint(x: 0, y: 499))
        XCTAssertEqual(mainDisplay.globalPoint(x: 1, y: 0), CGPoint(x: 999, y: 0))
        XCTAssertEqual(sideDisplay.globalPoint(x: 0, y: 0), CGPoint(x: 1000, y: -100))
    }

    func testMoveUsesDisplayOriginAndIgnoresUnknownDisplay() {
        let m = make()
        m.handle(.move(display: 1, x: 0.5, y: 0.5))
        m.handle(.move(display: 7, x: 0.5, y: 0.5))
        XCTAssertEqual(poster.calls, [.move(CGPoint(x: 1400, y: 200))])
    }

    func testClickDragSequence() {
        let m = make()
        m.handle(.button(display: 0, button: .left, down: true, x: 0.1, y: 0.1))
        m.handle(.move(display: 0, x: 0.2, y: 0.1))
        m.handle(.button(display: 0, button: .left, down: false, x: 0.2, y: 0.1))
        m.handle(.move(display: 0, x: 0.3, y: 0.1))
        XCTAssertEqual(poster.calls, [
            .button(.left, true, CGPoint(x: 100, y: 50), 1),
            .drag(CGPoint(x: 200, y: 50), .left),
            .button(.left, false, CGPoint(x: 200, y: 50), 1),
            .move(CGPoint(x: 300, y: 50)),
        ])
    }

    func testDoubleClickCountsWithinWindowAndDistance() {
        let m = make()
        func click(_ x: Double) {
            m.handle(.button(display: 0, button: .left, down: true, x: x, y: 0.5))
            m.handle(.button(display: 0, button: .left, down: false, x: x, y: 0.5))
        }
        click(0.5); clock += 0.2; click(0.5); clock += 0.2; click(0.5); clock += 0.2; click(0.5)
        let counts = poster.calls.compactMap { c -> Int? in if case let .button(_, true, _, n) = c { return n }; return nil }
        XCTAssertEqual(counts, [1, 2, 3, 3])
        clock += 1; click(0.5); clock += 0.1; click(0.9) // too far
        let tail = poster.calls.compactMap { c -> Int? in if case let .button(_, true, _, n) = c { return n }; return nil }.suffix(2)
        XCTAssertEqual(Array(tail), [1, 1])
    }

    func testRightButtonDoesNotDoubleWithLeft() {
        let m = make()
        m.handle(.button(display: 0, button: .left, down: true, x: 0.5, y: 0.5))
        m.handle(.button(display: 0, button: .left, down: false, x: 0.5, y: 0.5))
        m.handle(.button(display: 0, button: .right, down: true, x: 0.5, y: 0.5))
        XCTAssertEqual(poster.calls.last, .button(.right, true, CGPoint(x: 500, y: 250), 1))
    }

    func testScrollPixelsAndInvert() {
        var m = make()
        m.handle(.scroll(dx: 2.4, dy: -7.6)); m.handle(.scroll(dx: 0.2, dy: 0.1))
        XCTAssertEqual(poster.calls, [.scroll(2, -8)])
        m = make(invert: true)
        m.handle(.scroll(dx: 0, dy: 5))
        XCTAssertEqual(poster.calls, [.scroll(0, -5)])
    }

    func testMagnifyKeysStepAtAccumulatedThreshold() {
        let m = make()
        let cmdEq = [Call.key(24, true, .cmd), .key(24, false, .cmd)]
        let cmdMinus = [Call.key(27, true, .cmd), .key(27, false, .cmd)]
        m.handle(.magnify(0.05)); m.handle(.magnify(0.05))
        XCTAssertTrue(poster.calls.isEmpty)
        m.handle(.magnify(0.05))
        XCTAssertEqual(poster.calls, cmdEq)
        poster.calls = []
        m.handle(.magnify(-0.35))
        XCTAssertEqual(poster.calls, cmdMinus + cmdMinus)
    }

    func testMagnifyGestureModePassesDelta() {
        let m = make(mode: .gesture)
        m.handle(.magnify(0.03))
        XCTAssertEqual(poster.calls, [.magnify(0.03)])
    }

    func testSwipesMapToControlArrows() {
        let m = make()
        for d in [SwipeDirection.left, .right, .up, .down] { m.handle(.swipe(d)) }
        let codes: [UInt16] = [123, 124, 126, 125]
        XCTAssertEqual(poster.calls, codes.flatMap { [Call.key($0, true, .ctrl), .key($0, false, .ctrl)] })
    }

    func testKeyAndTextMapping() {
        let m = make()
        m.handle(.key(code: "KeyC", down: true, modifiers: [.cmd]))
        m.handle(.key(code: "KeyC", down: false, modifiers: [.cmd]))
        m.handle(.key(code: "Nonsense", down: true, modifiers: []))
        m.handle(.text("їжак"))
        XCTAssertEqual(poster.calls, [.key(8, true, .cmd), .key(8, false, .cmd), .text("їжак")])
    }

    func testLoneModifierPostsFlagsChangedAndStaysHeld() {
        let m = make()
        m.handle(.key(code: "MetaLeft", down: true, modifiers: []))
        m.handle(.key(code: "ShiftLeft", down: true, modifiers: []))
        m.handle(.key(code: "KeyA", down: true, modifiers: []))
        m.handle(.key(code: "ShiftLeft", down: false, modifiers: []))
        m.handle(.key(code: "MetaLeft", down: false, modifiers: []))
        XCTAssertEqual(poster.calls, [
            .flags(55, true, .cmd), .flags(56, true, [.cmd, .shift]), .key(0, true, [.cmd, .shift]),
            .flags(56, false, .cmd), .flags(55, false, []),
        ])
    }

    func testSubscribeProducesNoPosterCalls() {
        let m = make(); m.handle(.subscribe([0])); XCTAssertTrue(poster.calls.isEmpty)
    }
}

final class KeyCodeTests {
    func testKnownCodes() {
        XCTAssertEqual(KeyCodes.virtualKey(for: "KeyA"), 0)
        XCTAssertEqual(KeyCodes.virtualKey(for: "KeyZ"), 6)
        XCTAssertEqual(KeyCodes.virtualKey(for: "Digit1"), 18)
        XCTAssertEqual(KeyCodes.virtualKey(for: "Space"), 49)
        XCTAssertEqual(KeyCodes.virtualKey(for: "Enter"), 36)
        XCTAssertEqual(KeyCodes.virtualKey(for: "Backspace"), 51)
        XCTAssertEqual(KeyCodes.virtualKey(for: "Escape"), 53)
        XCTAssertEqual(KeyCodes.virtualKey(for: "ArrowUp"), 126)
        XCTAssertEqual(KeyCodes.virtualKey(for: "F12"), 111)
        XCTAssertNil(KeyCodes.virtualKey(for: "Bogus"))
    }

    func testTableHasNoDuplicateVirtualKeys() {
        let values = Array(KeyCodes.table.values)
        XCTAssertEqual(Set(values).count, values.count)
    }

    func testEveryLetterAndDigitIsMapped() {
        for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" { XCTAssertNotNil(KeyCodes.virtualKey(for: "Key\(c)"), "Key\(c)") }
        for d in 0...9 { XCTAssertNotNil(KeyCodes.virtualKey(for: "Digit\(d)")) }
    }
}
