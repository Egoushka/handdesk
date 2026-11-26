import Foundation
import CoreGraphics
import HandDeskCore

enum Call: Equatable {
    case move(CGPoint)
    case drag(CGPoint, MouseButton)
    case button(MouseButton, Bool, CGPoint, Int)
    case scroll(Int, Int)
    case magnify(Double)
    case key(UInt16, Bool, Modifiers)
    case flags(UInt16, Bool, Modifiers)
    case text(String)
}

final class FakePoster: EventPoster {
    var calls: [Call] = []
    func mouseMove(to p: CGPoint) { calls.append(.move(p)) }
    func mouseDrag(to p: CGPoint, button: MouseButton) { calls.append(.drag(p, button)) }
    func mouseButton(_ b: MouseButton, down: Bool, at p: CGPoint, clickCount: Int) { calls.append(.button(b, down, p, clickCount)) }
    func scroll(dx: Int, dy: Int) { calls.append(.scroll(dx, dy)) }
    func magnify(delta: Double) { calls.append(.magnify(delta)) }
    func key(code: UInt16, down: Bool, modifiers: Modifiers) { calls.append(.key(code, down, modifiers)) }
    func flagsChanged(code: UInt16, down: Bool, modifiers: Modifiers) { calls.append(.flags(code, down, modifiers)) }
    func text(_ s: String) { calls.append(.text(s)) }
}

let mainDisplay = DisplayInfo(id: 1, name: "Main", x: 0, y: 0, width: 1000, height: 500, pixelWidth: 2000, pixelHeight: 1000)
let sideDisplay = DisplayInfo(id: 2, name: "Side", x: 1000, y: -100, width: 800, height: 600, pixelWidth: 800, pixelHeight: 600)

func json(_ s: String) -> ClientMessage? { ClientMessage.decode(Data(s.utf8)) }
