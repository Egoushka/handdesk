import Foundation
import CoreGraphics
import ApplicationServices
import HandDeskCore

setvbuf(stdout, nil, _IOLBF, 0)

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("handdesk: \(message)\n".utf8))
    exit(2)
}

let supportDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/handdesk")
let tokenURL = supportDir.appendingPathComponent("token")

func permissionLines() -> [String] {
    [
        "Screen Recording: \(CGPreflightScreenCaptureAccess() ? "granted" : "NOT granted (System Settings > Privacy & Security > Screen Recording)")",
        "Accessibility:    \(AXIsProcessTrusted() ? "granted" : "NOT granted (System Settings > Privacy & Security > Accessibility)")",
    ]
}

func defaultWebRoot() -> String {
    let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let candidates = [exe.deletingLastPathComponent().appendingPathComponent("web").path,
                      FileManager.default.currentDirectoryPath + "/web/dist",
                      FileManager.default.currentDirectoryPath + "/../web/dist"]
    return candidates.first { FileManager.default.fileExists(atPath: $0 + "/index.html") } ?? candidates[0]
}

func parseStart(_ args: [String]) -> ServerConfig {
    var c = ServerConfig(webRoot: defaultWebRoot(), token: "")
    var i = 0
    func value(_ name: String) -> String {
        i += 1
        guard i < args.count else { fail("\(name) needs a value") }
        return args[i]
    }
    while i < args.count {
        switch args[i] {
        case "--port": guard let p = UInt16(value("--port")), p > 0 else { fail("bad --port") }; c.port = p
        case "--lan": c.lan = true
        case "--host": c.host = value("--host")
        case "--tls-p12": c.p12Path = value("--tls-p12")
        case "--web": c.webRoot = value("--web")
        case "--magnify": guard let m = MagnifyMode(rawValue: value("--magnify")) else { fail("--magnify keys|gesture") }; c.magnifyMode = m
        case "--invert-scroll": c.invertScroll = true
        case "--fps": guard let f = Int(value("--fps")), (1...120).contains(f) else { fail("bad --fps") }; c.fps = f
        case "--bitrate": guard let b = Int(value("--bitrate")), b > 0 else { fail("bad --bitrate") }; c.bitrate = b
        case "--max-width": guard let w = Int(value("--max-width")), w >= 320 else { fail("bad --max-width") }; c.maxWidth = w
        case "--no-adb": noAdb = true
        case "--log-level": guard let l = LogLevel(name: value("--log-level")), l <= .info else { fail("--log-level info|debug") }; logLevel = l
        default: fail("unknown option \(args[i])")
        }
        i += 1
    }
    if c.lan && c.p12Path == nil { fail("--lan needs --tls-p12 (WebXR needs a secure context; see docs/decisions.md D1)") }
    return c
}
var noAdb = false
var logLevel = LogLevel.info

func command(_ cmd: String) -> Never {
    let label = LaunchAgentPlist.label
    let plist = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    let domain = "gui/\(getuid())"
    func launchctl(_ args: [String]) {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/launchctl"); p.arguments = args
        try? p.run(); p.waitUntilExit()
    }
    switch cmd {
    case "install":
        let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath().path
        let extra = Array(CommandLine.arguments.dropFirst(3))
        let log = outLogURL.path
        try? FileManager.default.createDirectory(at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        do { try LaunchAgentPlist.make(programArguments: LaunchAgentPlist.arguments(executable: exe, extra: extra, defaultWebRoot: defaultWebRoot()), logPath: log).write(to: plist, atomically: true, encoding: .utf8) }
        catch { fail("cannot write \(plist.path): \(error.localizedDescription)") }
        launchctl(["bootout", "\(domain)/\(label)"])
        launchctl(["bootstrap", domain, plist.path])
        print("installed \(plist.path); structured log in \(logURL.path), launchd output in \(log)")
    case "uninstall":
        launchctl(["bootout", "\(domain)/\(label)"])
        try? FileManager.default.removeItem(at: plist)
        print("removed \(plist.path)")
    default: fail("launchagent install [start options] | uninstall")
    }
    exit(0)
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "start":
    var config = parseStart(Array(args.dropFirst()))
    log.level = logLevel
    do { config.token = try Token.loadOrCreate(at: tokenURL) } catch { log.error("error", ["where": "token", "message": error.localizedDescription]); fail("cannot store the pairing token: \(error.localizedDescription)") }
    let displays = Displays.list()
    guard !displays.isEmpty else { log.error("error", ["where": "displays", "message": "no active displays"]); fail("no active displays") }
    let server = Server(config: config, displays: displays, poster: CGEventPoster())
    do { try server.start() } catch { log.error("error", ["where": "listen", "port": Int(config.port), "message": error.localizedDescription]); fail("cannot listen on port \(config.port): \(error.localizedDescription)") }
    let perms = currentPermissions()
    log.info("start", ["version": agentVersion, "port": Int(config.port), "lan": config.lan, "displays": displays.count, "logLevel": logLevel.name,
                       "screenRecording": perms.screenRecording, "accessibility": perms.accessibility, "web": config.webRoot])
    if !FileManager.default.fileExists(atPath: config.webRoot + "/index.html") { log.warn("error", ["where": "web", "message": "no page at \(config.webRoot)"]) }
    if !noAdb && !config.lan { AdbSupervisor(port: config.port).start() }
    PermissionWatcher().start()
    // the pairing URL is shown only to a terminal; under launchd it would end up in a log file (use `handdesk open`)
    if isatty(1) != 0 { print("Open on the Quest: http://localhost:\(config.port)/?t=\(config.token)") }
    else { print("Pairing URL not printed (not a terminal): run `handdesk open` to open it on the headset") }
    RunLoop.main.run()
case "doctor":
    permissionLines().forEach { print($0) }
    print("Displays: \(Displays.list().map { "\($0.name) \(Int($0.width))x\(Int($0.height))" }.joined(separator: ", "))")
    print("adb: \(["/opt/homebrew/bin/adb", "/usr/local/bin/adb"].first { FileManager.default.isExecutableFile(atPath: $0) } ?? "not found")")
case "token":
    do { print(try Token.loadOrCreate(at: tokenURL)) } catch { fail("cannot read the pairing token: \(error.localizedDescription)") }
case "wifi":
    commandWifi()
case "open":
    var port: UInt16 = 8787
    if let i = args.firstIndex(of: "--port"), i + 1 < args.count, let p = UInt16(args[i + 1]) { port = p }
    commandOpen(port: port)
case "logs":
    commandLogs(args)
case "launchagent":
    command(args.dropFirst().first ?? "")
default:
    print("""
    handdesk start [--port 8787] [--lan --tls-p12 FILE --host NAME] [--web DIR] [--magnify keys|gesture] [--invert-scroll]
                   [--fps 60] [--bitrate 25000000] [--max-width 2560] [--no-adb] [--log-level info|debug]
    handdesk launchagent install [start options] | uninstall
    handdesk doctor
    handdesk token
    handdesk wifi                 (headset on USB once: switch adb to Wi-Fi)
    handdesk open [--port 8787]   (open the page on every connected headset)
    handdesk logs [-n 50]
    """)
}
