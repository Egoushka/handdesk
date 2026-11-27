import Foundation
import CoreGraphics
import ApplicationServices
import HandDeskCore

let logURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/handdesk.log")
/// launchd's stdout and stderr go here; the structured log is `logURL` (two writers on one file would break rotation).
let outLogURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/handdesk.out.log")

nonisolated(unsafe) var log = Logger(level: .info, sinks: [FileLogSink(path: logURL.path), StdoutSink()])

func currentPermissions() -> Permissions {
    Permissions(screenRecording: CGPreflightScreenCaptureAccess(), accessibility: AXIsProcessTrusted())
}

enum Shell {
    /// Runs a program and returns its exit status and combined output; kills it after `timeout` seconds.
    static func run(_ path: String, _ args: [String], timeout: TimeInterval = 8, environment: [String: String]? = nil) -> (status: Int32, output: String) {
        let p = Process()
        if let environment { p.environment = ProcessInfo.processInfo.environment.merging(environment) { $1 } }
        p.executableURL = URL(fileURLWithPath: path)
        p.arguments = args
        let pipe = Pipe()
        p.standardOutput = pipe; p.standardError = pipe
        do { try p.run() } catch { return (127, "cannot start: \(error.localizedDescription)") }
        let killer = DispatchWorkItem { if p.isRunning { p.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        killer.cancel()
        return (p.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}

let wifiMemoryURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/handdesk/wifi")
func rememberedWifi() -> [String] {
    ((try? String(contentsOf: wifiMemoryURL, encoding: .utf8)) ?? "").split(whereSeparator: \.isNewline).map { String($0) }
}
func rememberWifi(_ addr: String) {
    var all = rememberedWifi()
    if !all.contains(addr) { all.append(addr) }
    try? FileManager.default.createDirectory(at: wifiMemoryURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? all.joined(separator: "\n").write(to: wifiMemoryURL, atomically: true, encoding: .utf8)
}

func adbPath() -> String? { Adb.searchPaths.first { FileManager.default.isExecutableFile(atPath: $0) } }

func adbDevices(_ adb: String) -> [String] { Adb.parseDevices(Shell.run(adb, Adb.devicesArgs).output) }

/// Keeps `adb reverse tcp:PORT tcp:PORT` in place on every connected headset, USB or Wi-Fi.
final class AdbSupervisor {
    private let port: UInt16
    private let queue = DispatchQueue(label: "handdesk.adb")
    private var timer: DispatchSourceTimer?
    private var known: [String: Bool] = [:] // serial -> reverse in place
    private var warnedMissing = false

    init(port: UInt16) { self.port = port }

    func start() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: 10)
        t.setEventHandler { [weak self] in self?.tick() }
        t.resume()
        timer = t
    }

    private func tick() {
        guard let adb = adbPath() else {
            if !warnedMissing { warnedMissing = true; log.warn("adb", ["action": "missing", "hint": "install android-platform-tools"]) }
            return
        }
        warnedMissing = false
        var serials = adbDevices(adb)
        let missing = Adb.missingConnects(remembered: rememberedWifi(), connected: serials)
        for addr in missing {
            let c = Shell.run(adb, ["connect", addr], timeout: 5)
            if c.output.contains("connected") && !c.output.contains("failed") { log.info("adb", ["action": "wifi_reconnected", "serial": addr]) }
        }
        if !missing.isEmpty { serials = adbDevices(adb) }
        for gone in known.keys where !serials.contains(gone) {
            known[gone] = nil
            log.info("adb", ["action": "device_removed", "serial": gone])
        }
        for s in serials {
            if known[s] == nil { log.info("adb", ["action": "device_added", "serial": s, "wifi": Adb.isWifiSerial(s)]) }
            let list = Shell.run(adb, Adb.reverseListArgs(serial: s)).output
            if Adb.hasReverse(list, port: port) { known[s] = true; continue }
            let r = Shell.run(adb, Adb.reverseArgs(serial: s, port: port))
            let ok = r.status == 0
            if known[s] != ok || known[s] == nil { // log changes, not every retry
                if ok { log.info("adb", ["action": "reverse_set", "serial": s, "port": Int(port)]) }
                else { log.error("adb", ["action": "reverse_failed", "serial": s, "status": Int(r.status), "output": LogScrub.clean(r.output, max: 200)]) }
            }
            known[s] = ok
        }
    }
}

/// Polls the two macOS permissions and logs a change.
final class PermissionWatcher {
    private var last = currentPermissions()
    private var timer: DispatchSourceTimer?
    func start() {
        let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "handdesk.permissions"))
        t.schedule(deadline: .now() + 5, repeating: 5)
        t.setEventHandler { [weak self] in
            guard let self = self else { return }
            let now = currentPermissions()
            if now != self.last {
                self.last = now
                log.info("permission_change", ["screenRecording": now.screenRecording, "accessibility": now.accessibility])
            }
        }
        t.resume()
        timer = t
    }
}

// MARK: commands

func commandWifi() -> Never {
    guard let adb = adbPath() else { fail("adb not found: install android-platform-tools") }
    let usb = adbDevices(adb).filter { !Adb.isWifiSerial($0) }
    guard let serial = usb.first else { fail("connect the headset by USB once, with debugging allowed, then run this again") }
    let tcpip = Shell.run(adb, Adb.tcpipArgs(serial: serial))
    guard tcpip.status == 0 else { fail("adb tcpip failed: \(LogScrub.clean(tcpip.output, max: 200))") }
    Thread.sleep(forTimeInterval: 2)
    let addr = Shell.run(adb, Adb.wifiAddressArgs(serial: serial))
    guard let ip = Adb.parseWifiAddress(addr.output) else { fail("the headset has no Wi-Fi address (is it on Wi-Fi?)") }
    let c = Shell.run(adb, Adb.connectArgs(address: ip))
    guard c.status == 0, c.output.contains("connected") else { fail("adb connect failed: \(LogScrub.clean(c.output, max: 200))") }
    rememberWifi("\(ip):5555")
    log.info("adb", ["action": "wifi_connected", "serial": "\(ip):5555"])
    print("\(ip):5555")
    exit(0)
}

func commandOpen(port: UInt16) -> Never {
    guard let adb = adbPath() else { fail("adb not found: install android-platform-tools") }
    let token: String
    do { token = try Token.loadOrCreate(at: tokenURL) } catch { fail("cannot read the pairing token: \(error.localizedDescription)") }
    // with a certificate the headset opens the https name (no cable needed afterwards); otherwise localhost through adb reverse
    let tls = CertCommand.active()
    let url = tls.map { Cert.pageURL(host: $0.host, port: port, token: token) } ?? Adb.pageURL(port: port, token: token)
    var opened = 0
    for s in adbDevices(adb) {
        // the page needs the reverse: set it now and fail loudly if it cannot be
        if tls == nil, !Adb.hasReverse(Shell.run(adb, Adb.reverseListArgs(serial: s)).output, port: port),
           Shell.run(adb, Adb.reverseArgs(serial: s, port: port)).status != 0 { log.error("adb", ["action": "reverse_failed", "serial": s]); fail("adb reverse failed on \(s); the page would not load") }
        // adb echoes the intent, which contains the URL: the output is never printed or logged
        if Shell.run(adb, Adb.openArgs(serial: s, url: url)).status == 0 { opened += 1; log.info("adb", ["action": "opened_page", "serial": s]) }
        else { log.error("adb", ["action": "open_failed", "serial": s]) }
    }
    print("opened on \(opened) device(s)")
    exit(opened > 0 ? 0 : 1)
}

func commandLogs(_ args: [String]) -> Never {
    var n = 50
    if let i = args.firstIndex(of: "-n"), i + 1 < args.count, let v = Int(args[i + 1]), v > 0 { n = v }
    guard let text = try? String(contentsOf: logURL, encoding: .utf8) else { fail("no log yet at \(logURL.path)") }
    text.split(separator: "\n", omittingEmptySubsequences: true).suffix(n).forEach { print($0) }
    exit(0)
}
