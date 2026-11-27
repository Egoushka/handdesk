import Foundation
import ScreenCaptureKit
import CoreMedia
import HandDeskCore

/// One ScreenCaptureKit stream plus encoder per streamed display or window. `index` is the wire stream id (displays 0...127, windows 128...255).
final class DisplayStream: NSObject, SCStreamOutput, SCStreamDelegate {
    let index: Int
    private let info: DisplayInfo?
    let window: WindowInfo?
    /// encoded size in pixels, valid after start
    private(set) var outWidth = 0, outHeight = 0
    private var stream: SCStream?
    private var encoder: H264Encoder?
    private let queue = DispatchQueue(label: "handdesk.capture")
    var onFrame: ((Int, Data, Bool, UInt64) -> Void)?

    init(index: Int, info: DisplayInfo) { self.index = index; self.info = info; self.window = nil }
    init(index: Int, window: WindowInfo) { self.index = index; self.info = nil; self.window = window }

    func start(fps: Int, bitrate: Int, maxWidth: Int) async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let filter: SCContentFilter
        let pxW: Int, pxH: Int
        if let info = info {
            guard let display = content.displays.first(where: { $0.displayID == info.id }) else {
                throw NSError(domain: "handdesk", code: 1, userInfo: [NSLocalizedDescriptionKey: "display \(info.id) not found"])
            }
            filter = SCContentFilter(display: display, excludingWindows: [])
            pxW = info.pixelWidth; pxH = info.pixelHeight
        } else if let window = window {
            guard let w = content.windows.first(where: { $0.windowID == window.id }) else {
                throw NSError(domain: "handdesk", code: 1, userInfo: [NSLocalizedDescriptionKey: "window \(window.id) not found"])
            }
            filter = SCContentFilter(desktopIndependentWindow: w)
            pxW = Int(window.width * 2); pxH = Int(window.height * 2) // assume a Retina backing; capped by maxWidth below
        } else { throw NSError(domain: "handdesk", code: 1, userInfo: [NSLocalizedDescriptionKey: "nothing to capture"]) }
        let scale = min(1.0, Double(maxWidth) / Double(max(pxW, 1)))
        let w = max(2, Int(Double(pxW) * scale) & ~1), h = max(2, Int(Double(pxH) * scale) & ~1)
        outWidth = w; outHeight = h
        let cfg = SCStreamConfiguration()
        cfg.width = w; cfg.height = h
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        cfg.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        cfg.showsCursor = true
        cfg.queueDepth = 3
        encoder = H264Encoder(width: w, height: h, fps: fps, bitrate: bitrate) { [weak self] data, key, micros in
            guard let self = self else { return }
            self.onFrame?(self.index, data, key, micros)
        }
        guard encoder != nil else { throw NSError(domain: "handdesk", code: 2, userInfo: [NSLocalizedDescriptionKey: "encoder unavailable"]) }
        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
    }

    func requestKeyframe() { encoder?.requestKeyframe() }

    func stop() {
        let s = stream; stream = nil
        Task { do { try await s?.stopCapture() } catch { log.error("error", ["where": "capture_stop", "stream": index, "message": error.localizedDescription]) } }
        encoder?.stop(); encoder = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid,
              let atts = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let raw = atts.first?[.status] as? Int, SCFrameStatus(rawValue: raw) == .complete,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        encoder?.encode(pixels, pts: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log.error("error", ["where": "capture_stopped", "stream": index, "message": error.localizedDescription])
    }
}
