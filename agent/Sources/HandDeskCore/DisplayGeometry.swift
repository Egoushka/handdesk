import Foundation
import CoreGraphics

public struct DisplayInfo: Equatable {
    public var id: UInt32
    public var name: String
    public var x: Double, y: Double, width: Double, height: Double
    public var pixelWidth: Int, pixelHeight: Int
    public init(id: UInt32, name: String, x: Double, y: Double, width: Double, height: Double, pixelWidth: Int, pixelHeight: Int) {
        self.id = id; self.name = name; self.x = x; self.y = y; self.width = width; self.height = height
        self.pixelWidth = pixelWidth; self.pixelHeight = pixelHeight
    }

    /// Normalized (0..1, top-left origin) to global points, clamped to this display.
    public func globalPoint(x nx: Double, y ny: Double) -> CGPoint {
        let cx = min(max(nx, 0), 1), cy = min(max(ny, 0), 1)
        // Stay one point inside the edge so the point still belongs to this display.
        let px = min(x + cx * width, x + width - 1)
        let py = min(y + cy * height, y + height - 1)
        return CGPoint(x: px, y: py)
    }

    public var helloJSON: [String: Any] {
        ["id": Int(id), "name": name, "x": x, "y": y, "width": width, "height": height,
         "pixelWidth": pixelWidth, "pixelHeight": pixelHeight]
    }
}

public func helloMessage(displays: [DisplayInfo]) -> Data {
    let obj: [String: Any] = ["type": "hello", "version": 1, "displays": displays.map(\.helloJSON)]
    return (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
}

public func errorMessage(_ message: String) -> Data {
    (try? JSONSerialization.data(withJSONObject: ["type": "error", "message": message], options: [.sortedKeys])) ?? Data()
}
