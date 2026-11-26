import Foundation

public enum VideoFrame {
    /// byte 0 = 0x01, byte 1 = display index, byte 2 = flags (bit 0 keyframe), bytes 3..10 = u64 BE microseconds, then Annex B.
    public static func message(display: UInt8, keyframe: Bool, micros: UInt64, annexB: Data) -> Data {
        var out = Data([0x01, display, keyframe ? 1 : 0])
        for s in stride(from: 56, through: 0, by: -8) { out.append(UInt8((micros >> UInt64(s)) & 0xFF)) }
        out.append(annexB)
        return out
    }
}

public enum AnnexB {
    static let startCode = Data([0, 0, 0, 1])

    /// Converts length-prefixed NAL units (AVCC) to Annex B. Returns nil on a truncated stream.
    public static func convert(avcc: Data, nalLengthSize: Int = 4, parameterSets: [Data] = []) -> Data? {
        var out = Data()
        for ps in parameterSets { out.append(startCode); out.append(ps) }
        let b = [UInt8](avcc)
        var i = 0
        while i < b.count {
            guard i + nalLengthSize <= b.count else { return nil }
            var len = 0
            for k in 0..<nalLengthSize { len = len << 8 | Int(b[i + k]) }
            i += nalLengthSize
            guard len > 0, i + len <= b.count else { return nil }
            out.append(startCode)
            out.append(contentsOf: b[i..<i + len])
            i += len
        }
        return out
    }
}
