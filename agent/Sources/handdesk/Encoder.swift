import Foundation
import VideoToolbox
import CoreMedia
import HandDeskCore

/// H.264 real-time encoder for one display. `onFrame` gets one Annex B access unit per call.
final class H264Encoder {
    private var session: VTCompressionSession?
    private var forceKey = true
    private let onFrame: (Data, Bool, UInt64) -> Void
    private var lastKey = Date.distantPast
    private var lastBuffer: CVPixelBuffer?
    private let lock = NSLock()

    init?(width: Int, height: Int, fps: Int, bitrate: Int, onFrame: @escaping (Data, Bool, UInt64) -> Void) {
        self.onFrame = onFrame
        var s: VTCompressionSession?
        let status = VTCompressionSessionCreate(allocator: nil, width: Int32(width), height: Int32(height), codecType: kCMVideoCodecType_H264,
                                                encoderSpecification: nil, imageBufferAttributes: nil, compressedDataAllocator: nil,
                                                outputCallback: nil, refcon: nil, compressionSessionOut: &s)
        guard status == noErr, let session = s else { return nil }
        self.session = session
        func set(_ key: CFString, _ value: CFTypeRef) { VTSessionSetProperty(session, key: key, value: value) }
        set(kVTCompressionPropertyKey_RealTime, kCFBooleanTrue)
        set(kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel)
        set(kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse)
        set(kVTCompressionPropertyKey_AverageBitRate, bitrate as CFNumber)
        set(kVTCompressionPropertyKey_ExpectedFrameRate, fps as CFNumber)
        set(kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, 2 as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(session)
    }

    func requestKeyframe() {
        lock.lock(); forceKey = true; let buf = lastBuffer; lock.unlock()
        if let buf = buf { encode(buf, pts: CMClockGetTime(CMClockGetHostTimeClock())) } // a static screen sends no new frames
    }

    func encode(_ buffer: CVPixelBuffer, pts: CMTime) {
        guard let session = session else { return }
        lock.lock()
        lastBuffer = buffer
        let key = forceKey || Date().timeIntervalSince(lastKey) > 2
        forceKey = false
        if key { lastKey = Date() }
        lock.unlock()
        let props: CFDictionary? = key ? [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue!] as CFDictionary : nil
        VTCompressionSessionEncodeFrame(session, imageBuffer: buffer, presentationTimeStamp: pts, duration: .invalid,
                                        frameProperties: props, infoFlagsOut: nil) { [weak self] status, _, sample in
            guard status == noErr, let sample = sample, let self = self else { return }
            self.deliver(sample)
        }
    }

    private func deliver(_ sample: CMSampleBuffer) {
        guard let block = CMSampleBufferGetDataBuffer(sample) else { return }
        var length = 0
        var ptr: UnsafeMutablePointer<Int8>?
        guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &ptr) == kCMBlockBufferNoErr,
              let base = ptr else { return }
        let avcc = Data(bytes: base, count: length)
        var isKey = true
        if let atts = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]], let first = atts.first {
            isKey = !(first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
        }
        var sets: [Data] = []
        if isKey, let fmt = CMSampleBufferGetFormatDescription(sample) {
            var count = 0
            CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
            for i in 0..<count {
                var p: UnsafePointer<UInt8>?
                var size = 0
                if CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &p, parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let p = p {
                    sets.append(Data(bytes: p, count: size))
                }
            }
        }
        guard let annexB = AnnexB.convert(avcc: avcc, parameterSets: sets) else { return }
        let micros = UInt64(max(0, CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample)) * 1_000_000))
        onFrame(annexB, isKey, micros)
    }

    func stop() {
        if let s = session { VTCompressionSessionInvalidate(s) }
        session = nil
    }
}
