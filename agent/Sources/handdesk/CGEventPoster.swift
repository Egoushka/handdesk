import Foundation
import CoreGraphics
import HandDeskCore

final class CGEventPoster: EventPoster {
    private let source = CGEventSource(stateID: .hidSystemState)

    func mouseMove(to point: CGPoint) {
        CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    }

    func mouseDrag(to point: CGPoint, button: MouseButton) {
        let type: CGEventType = button == .left ? .leftMouseDragged : .rightMouseDragged
        CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button == .left ? .left : .right)?.post(tap: .cghidEventTap)
    }

    func mouseButton(_ button: MouseButton, down: Bool, at point: CGPoint, clickCount: Int) {
        let type: CGEventType = button == .left ? (down ? .leftMouseDown : .leftMouseUp) : (down ? .rightMouseDown : .rightMouseUp)
        let e = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button == .left ? .left : .right)
        e?.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount))
        e?.post(tap: .cghidEventTap)
    }

    func scroll(dx: Int, dy: Int) {
        CGEvent(scrollWheelEvent2Source: source, units: .pixel, wheelCount: 2, wheel1: Int32(clamping: dy), wheel2: Int32(clamping: dx), wheel3: 0)?.post(tap: .cghidEventTap)
    }

    /// Experimental: a synthetic gesture event (type 29, subtype 8, field 113 = magnification). Undocumented; behind --magnify=gesture.
    func magnify(delta: Double) {
        guard let e = CGEvent(source: source), let type = CGEventType(rawValue: 29),
              let subtype = CGEventField(rawValue: 110), let amount = CGEventField(rawValue: 113) else { return }
        e.type = type
        e.setIntegerValueField(subtype, value: 8)
        e.setDoubleValueField(amount, value: delta)
        e.post(tap: .cghidEventTap)
    }

    func key(code: UInt16, down: Bool, modifiers: Modifiers) {
        guard let e = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(code), keyDown: down) else { return }
        e.flags = CGEventFlags(rawValue: modifiers.cgFlagBits)
        e.post(tap: .cghidEventTap)
    }

    func flagsChanged(code: UInt16, down: Bool, modifiers: Modifiers) {
        guard let e = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(code), keyDown: down) else { return }
        e.type = .flagsChanged
        e.flags = CGEventFlags(rawValue: modifiers.cgFlagBits)
        e.post(tap: .cghidEventTap)
    }

    /// Chunks of at most 16 UTF-16 units: apps keep only the first few units of one event's Unicode string.
    /// Virtual key 0 is the A key; apps that read key codes instead of the string may see an "a" (not verified without the headset).
    func text(_ string: String) {
        for units in TextChunks.split(string, maxUnits: 16) {
            for down in [true, false] {
                guard let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
                e.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                e.flags = []
                e.post(tap: .cghidEventTap)
            }
        }
    }
}
