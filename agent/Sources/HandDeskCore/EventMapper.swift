import Foundation
import CoreGraphics

public enum MagnifyMode: String { case keys, gesture }

/// Turns client messages into poster calls. Not thread safe: call from one queue.
public final class EventMapper {
    public static let doubleClickInterval: TimeInterval = 0.4
    public static let doubleClickDistance: Double = 8
    public static let magnifyStep: Double = 0.12

    public var displays: [DisplayInfo]
    public var magnifyMode: MagnifyMode
    public var invertScroll: Bool
    private let poster: EventPoster
    private let now: () -> TimeInterval

    private var heldButton: MouseButton?
    private var lastDown: (button: MouseButton, point: CGPoint, time: TimeInterval, count: Int)?
    private var magnifyAccumulator = 0.0
    private var heldModifiers: Modifiers = []

    public init(poster: EventPoster, displays: [DisplayInfo], magnifyMode: MagnifyMode = .keys,
                invertScroll: Bool = false, now: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.poster = poster; self.displays = displays; self.magnifyMode = magnifyMode
        self.invertScroll = invertScroll; self.now = now
    }

    private func display(_ index: Int) -> DisplayInfo? { displays.indices.contains(index) ? displays[index] : nil }

    public func handle(_ message: ClientMessage) {
        switch message {
        case .subscribe:
            break // owned by the server
        case let .move(d, x, y):
            guard let disp = display(d) else { return }
            let p = disp.globalPoint(x: x, y: y)
            if let b = heldButton { poster.mouseDrag(to: p, button: b) } else { poster.mouseMove(to: p) }
        case let .button(d, button, down, x, y):
            guard let disp = display(d) else { return }
            let p = disp.globalPoint(x: x, y: y)
            if down {
                let t = now()
                var count = 1
                if let last = lastDown, last.button == button, t - last.time <= Self.doubleClickInterval,
                   hypot(Double(p.x - last.point.x), Double(p.y - last.point.y)) <= Self.doubleClickDistance {
                    count = min(last.count + 1, 3)
                }
                lastDown = (button, p, t, count)
                heldButton = button
                poster.mouseButton(button, down: true, at: p, clickCount: count)
            } else {
                heldButton = nil
                poster.mouseButton(button, down: false, at: p, clickCount: lastDown?.count ?? 1)
            }
        case let .scroll(dx, dy):
            let sign: Double = invertScroll ? -1 : 1
            let ix = Int((dx * sign).rounded()), iy = Int((dy * sign).rounded())
            if ix != 0 || iy != 0 { poster.scroll(dx: ix, dy: iy) }
        case let .magnify(delta):
            guard delta.isFinite else { return }
            if magnifyMode == .gesture { poster.magnify(delta: delta); return }
            magnifyAccumulator += delta
            while magnifyAccumulator >= Self.magnifyStep { magnifyAccumulator -= Self.magnifyStep; tap("Equal", .cmd) }
            while magnifyAccumulator <= -Self.magnifyStep { magnifyAccumulator += Self.magnifyStep; tap("Minus", .cmd) }
        case let .swipe(dir):
            switch dir {
            case .left: tap("ArrowLeft", .ctrl)
            case .right: tap("ArrowRight", .ctrl)
            case .up: tap("ArrowUp", .ctrl)
            case .down: tap("ArrowDown", .ctrl)
            }
        case let .key(code, down, mods):
            if let m = KeyCodes.modifierKeys[code], let vk = KeyCodes.virtualKey(for: code) {
                if down { heldModifiers.insert(m) } else { heldModifiers.remove(m) }
                poster.flagsChanged(code: vk, down: down, modifiers: heldModifiers)
            } else if let vk = KeyCodes.virtualKey(for: code) {
                poster.key(code: vk, down: down, modifiers: mods.union(heldModifiers))
            }
        case let .text(s):
            poster.text(s)
        }
    }

    private func tap(_ domCode: String, _ mods: Modifiers) {
        guard let vk = KeyCodes.virtualKey(for: domCode) else { return }
        poster.key(code: vk, down: true, modifiers: mods)
        poster.key(code: vk, down: false, modifiers: mods)
    }
}
