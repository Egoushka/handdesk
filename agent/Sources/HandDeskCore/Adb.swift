import Foundation

/// Pure helpers for driving adb; the process running lives in the app target.
public enum Adb {
    public static let searchPaths = ["/opt/homebrew/bin/adb", "/usr/local/bin/adb"]
    public static let headsetBrowser = "com.oculus.browser"

    /// Serials in state `device` from `adb devices` output (USB serials and `ip:port` Wi-Fi serials).
    public static func parseDevices(_ output: String) -> [String] {
        output.split(whereSeparator: \.isNewline).compactMap { line in
            let parts = line.split(whereSeparator: { $0 == "\t" || $0 == " " })
            guard parts.count >= 2, parts[1] == "device", parts[0] != "List" else { return nil }
            return String(parts[0])
        }
    }

    /// True when `adb reverse --list` output has tcp:PORT forwarded to tcp:PORT.
    public static func hasReverse(_ output: String, port: UInt16) -> Bool {
        output.split(whereSeparator: \.isNewline).contains { line in
            let parts = line.split(separator: " ")
            return parts.count >= 2 && parts[parts.count - 2] == "tcp:\(port)" && parts[parts.count - 1] == "tcp:\(port)"
        }
    }

    public static func reverseListArgs(serial: String) -> [String] { ["-s", serial, "reverse", "--list"] }
    public static func reverseArgs(serial: String, port: UInt16) -> [String] { ["-s", serial, "reverse", "tcp:\(port)", "tcp:\(port)"] }
    public static let devicesArgs = ["devices"]
    public static func tcpipArgs(serial: String, port: Int = 5555) -> [String] { ["-s", serial, "tcpip", String(port)] }
    public static func wifiAddressArgs(serial: String) -> [String] { ["-s", serial, "shell", "ip", "-f", "inet", "addr", "show", "wlan0"] }
    public static func connectArgs(address: String, port: Int = 5555) -> [String] { ["connect", "\(address):\(port)"] }
    public static func openArgs(serial: String, url: String) -> [String] {
        ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, headsetBrowser]
    }

    /// First IPv4 address in `ip -f inet addr show wlan0` output.
    public static func parseWifiAddress(_ output: String) -> String? {
        for line in output.split(whereSeparator: \.isNewline) {
            let parts = line.split(separator: " ")
            if let i = parts.firstIndex(of: "inet"), i + 1 < parts.count {
                let addr = parts[i + 1].split(separator: "/")[0]
                let octets = addr.split(separator: ".")
                if octets.count == 4, octets.allSatisfy({ Int($0).map { (0...255).contains($0) } ?? false }) { return String(addr) }
            }
        }
        return nil
    }

    public static func pageURL(port: UInt16, token: String) -> String { "http://localhost:\(port)/?t=\(token)" }

    /// Serials that are Wi-Fi (`ip:port`) rather than USB.
    public static func isWifiSerial(_ s: String) -> Bool { s.contains(":") && s.split(separator: ".").count == 4 }
}
