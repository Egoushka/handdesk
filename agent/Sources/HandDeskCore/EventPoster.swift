import Foundation
import CoreGraphics

/// The only door to the OS. Production posts CGEvents; tests record calls.
public protocol EventPoster: AnyObject {
    func mouseMove(to point: CGPoint)
    func mouseDrag(to point: CGPoint, button: MouseButton)
    func mouseButton(_ button: MouseButton, down: Bool, at point: CGPoint, clickCount: Int)
    func scroll(dx: Int, dy: Int)
    func magnify(delta: Double)
    func key(code: UInt16, down: Bool, modifiers: Modifiers)
    /// A lone modifier key press or release; `modifiers` is the set held after the change.
    func flagsChanged(code: UInt16, down: Bool, modifiers: Modifiers)
    func text(_ string: String)
}
