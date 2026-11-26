import Foundation
import CryptoKit

public enum WSOpcode: UInt8 { case continuation = 0, text = 1, binary = 2, close = 8, ping = 9, pong = 10 }

public struct WSFrame: Equatable {
    public var fin: Bool
    public var opcode: WSOpcode
    public var payload: Data
    public init(fin: Bool = true, opcode: WSOpcode, payload: Data) { self.fin = fin; self.opcode = opcode; self.payload = payload }
}

public enum WSParseResult: Equatable {
    case incomplete
    case invalid
    case frame(WSFrame, consumed: Int)
}

public enum WebSocket {
    public static let maxPayload = 1 << 20

    public static func acceptKey(for clientKey: String) -> String {
        let digest = Insecure.SHA1.hash(data: Data((clientKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))
        return Data(digest).base64EncodedString()
    }

    public static func isUpgrade(_ req: HTTPRequest) -> Bool {
        req.method == "GET" && req.headers["upgrade"]?.lowercased() == "websocket"
            && (req.headers["connection"]?.lowercased().contains("upgrade") ?? false)
            && req.headers["sec-websocket-key"] != nil && req.headers["sec-websocket-version"] == "13"
    }

    public static func handshakeResponse(for req: HTTPRequest) -> Data? {
        guard isUpgrade(req), let key = req.headers["sec-websocket-key"] else { return nil }
        let s = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(acceptKey(for: key))\r\n\r\n"
        return Data(s.utf8)
    }

    /// Server-to-client frame: never masked.
    public static func encode(opcode: WSOpcode, payload: Data) -> Data {
        var out = Data([0x80 | opcode.rawValue])
        let n = payload.count
        if n < 126 { out.append(UInt8(n)) }
        else if n <= 0xFFFF { out.append(126); out.append(UInt8(n >> 8)); out.append(UInt8(n & 0xFF)) }
        else { out.append(127); for s in stride(from: 56, through: 0, by: -8) { out.append(UInt8((UInt64(n) >> UInt64(s)) & 0xFF)) } }
        out.append(payload)
        return out
    }

    /// Parses one client frame (masked). Fragmentation is not supported: a frame with fin == false is invalid.
    public static func parse(_ data: Data) -> WSParseResult {
        let b = [UInt8](data)
        guard b.count >= 2 else { return .incomplete }
        let fin = b[0] & 0x80 != 0
        guard b[0] & 0x70 == 0, let op = WSOpcode(rawValue: b[0] & 0x0F), fin, op != .continuation else { return .invalid }
        let masked = b[1] & 0x80 != 0
        guard masked else { return .invalid }
        var len = Int(b[1] & 0x7F)
        var idx = 2
        if len == 126 {
            guard b.count >= 4 else { return .incomplete }
            len = Int(b[2]) << 8 | Int(b[3]); idx = 4
        } else if len == 127 {
            guard b.count >= 10 else { return .incomplete }
            var v: UInt64 = 0
            for i in 2..<10 { v = v << 8 | UInt64(b[i]) }
            guard v <= UInt64(maxPayload) else { return .invalid }
            len = Int(v); idx = 10
        }
        guard len <= maxPayload else { return .invalid }
        if op.rawValue >= 8 && len > 125 { return .invalid }
        guard b.count >= idx + 4 + len else { return .incomplete }
        let mask = Array(b[idx..<idx + 4]); idx += 4
        var payload = [UInt8](repeating: 0, count: len)
        for i in 0..<len { payload[i] = b[idx + i] ^ mask[i % 4] }
        return .frame(WSFrame(fin: fin, opcode: op, payload: Data(payload)), consumed: idx + len)
    }

    /// Client-side encoding, used by tests.
    public static func encodeMasked(opcode: WSOpcode, payload: Data, mask: [UInt8] = [1, 2, 3, 4]) -> Data {
        var out = Data([0x80 | opcode.rawValue])
        let n = payload.count
        if n < 126 { out.append(0x80 | UInt8(n)) }
        else if n <= 0xFFFF { out.append(0x80 | 126); out.append(UInt8(n >> 8)); out.append(UInt8(n & 0xFF)) }
        else { out.append(0x80 | 127); for s in stride(from: 56, through: 0, by: -8) { out.append(UInt8((UInt64(n) >> UInt64(s)) & 0xFF)) } }
        out.append(contentsOf: mask)
        for (i, byte) in payload.enumerated() { out.append(byte ^ mask[i % 4]) }
        return out
    }
}
