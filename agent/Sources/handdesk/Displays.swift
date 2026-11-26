import Foundation
import CoreGraphics
import HandDeskCore

enum Displays {
    /// Active displays, main display first (index 0).
    static func list() -> [DisplayInfo] {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        let main = CGMainDisplayID()
        ids = ids.filter { $0 != 0 }.sorted { a, b in a == main ? true : (b == main ? false : a < b) }
        return ids.enumerated().map { i, id in
            let b = CGDisplayBounds(id)
            return DisplayInfo(id: id, name: id == main ? "Main display" : "Display \(i + 1)", x: b.origin.x, y: b.origin.y,
                               width: b.width, height: b.height, pixelWidth: CGDisplayPixelsWide(id), pixelHeight: CGDisplayPixelsHigh(id))
        }
    }
}
