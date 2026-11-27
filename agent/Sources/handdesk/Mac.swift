import Foundation
import AppKit
import CoreGraphics
import IOKit
import IOKit.graphics
import CVD
import HandDeskCore
import ApplicationServices

/// Private but long-stable: the CGWindowID of an Accessibility window element.
@_silgen_name("_AXUIElementGetWindow")
func _AXUIElementGetWindow(_ element: AXUIElement, _ id: UnsafeMutablePointer<CGWindowID>) -> AXError

/// The real OS behind `SystemServices`. Nothing here is unit tested (it needs a live session); the logic around it is.
final class RealSystem: SystemServices {
    private let dim = DimController()

    func listWindows() -> [WindowInfo] {
        guard let rows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
        var regular: [Int32: Bool] = [:]
        let raw: [RawWindow] = rows.compactMap { r in
            guard let id = (r[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
                  let pid = (r[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
                  let b = r[kCGWindowBounds as String] as? [String: Any],
                  let x = (b["X"] as? NSNumber)?.doubleValue, let y = (b["Y"] as? NSNumber)?.doubleValue,
                  let w = (b["Width"] as? NSNumber)?.doubleValue, let h = (b["Height"] as? NSNumber)?.doubleValue else { return nil }
            if regular[pid] == nil { regular[pid] = NSRunningApplication(processIdentifier: pid)?.activationPolicy == .regular }
            return RawWindow(id: id, pid: pid, owner: (r[kCGWindowOwnerName as String] as? String) ?? "",
                             title: (r[kCGWindowName as String] as? String) ?? "",
                             layer: (r[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
                             onScreen: (r[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? true,
                             x: x, y: y, width: w, height: h, regularApp: regular[pid] ?? false)
        }
        return WindowFilter.filter(raw, ownPID: ProcessInfo.processInfo.processIdentifier)
    }

    func listApps() -> [AppInfo] {
        NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && $0.bundleIdentifier != nil }
            .map { AppInfo(name: $0.localizedName ?? $0.bundleIdentifier ?? "?", bundleId: $0.bundleIdentifier ?? "", pid: $0.processIdentifier, active: $0.isActive) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// NSRunningApplication.activate is only a request: from a background agent on macOS 14+ it often does nothing. The Accessibility API (which the
    /// agent already needs to post input) sets the app frontmost and raises the exact window, so those go first; activate is the fallback.
    func activate(pid: Int32) {
        if setFrontmost(pid: pid) { return }
        _ = NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
    }

    func raise(window: UInt32, pid: Int32) {
        var raised = false
        if AXIsProcessTrusted() {
            let app = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(app, 1.0)
            var ref: CFTypeRef?
            if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &ref) == .success, let wins = ref as? [AXUIElement] {
                for w in wins {
                    var id: CGWindowID = 0
                    if _AXUIElementGetWindow(w, &id) == .success, id == window {
                        raised = AXUIElementPerformAction(w, kAXRaiseAction as CFString) == .success
                        AXUIElementSetAttributeValue(w, kAXMainAttribute as CFString, kCFBooleanTrue)
                        break
                    }
                }
            }
        }
        let front = setFrontmost(pid: pid)
        if !front { _ = NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows]) }
        log.info("raise_result", ["window": Int(window), "raised": raised, "frontmost": front, "trusted": AXIsProcessTrusted()])
    }

    private func setFrontmost(pid: Int32) -> Bool {
        guard AXIsProcessTrusted() else { return false }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.0)
        return AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue) == .success
    }

    func activate(bundleId: String) -> Bool {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else { return false }
        return app.activate(options: [.activateAllWindows])
    }

    func launch(bundleId: String) -> Bool {
        if activate(bundleId: bundleId) { return true }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { return false }
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if let e = error { log.error("error", ["where": "launch", "bundleId": bundleId, "message": e.localizedDescription]) }
        }
        return true
    }

    func quit(bundleId: String) -> Bool {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        for a in apps { a.terminate() }
        return !apps.isEmpty
    }

    func spotlight(query: String, completion: @escaping ([SpotlightHit]) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            func paths(_ args: [String]) -> [String] {
                Shell.run("/usr/bin/mdfind", args, timeout: 2).output.split(separator: "\n").map(String.init).filter { $0.hasPrefix("/") }
            }
            completion(SpotlightSearch.rank(appPaths: paths(SpotlightSearch.appArguments(query: query)),
                                            filePaths: paths(SpotlightSearch.fileArguments(query: query))))
        }
    }

    func openPath(_ path: String) -> Bool { NSWorkspace.shared.open(URL(fileURLWithPath: path)) }

    func createVirtualDisplay(width: Int, height: Int, name: String) -> Result<UInt32, VirtualDisplayError> {
        var err = [CChar](repeating: 0, count: 200)
        let id = cvd_create(name, UInt32(width), UInt32(height), &err, err.count)
        return id != 0 ? .success(id) : .failure(VirtualDisplayError(String(cString: err)))
    }

    func removeVirtualDisplay(id: UInt32) -> Bool { cvd_remove(id) }

    func setDim(_ on: Bool) -> Bool { on ? dim.dim() : dim.restore() }
}

/// Dims the built-in display to zero and puts the remembered brightness back. DisplayServices (Apple silicon) first, IOKit second.
final class DimController {
    private var saved: Float?
    private typealias GetFn = @convention(c) (UInt32, UnsafeMutablePointer<Float>) -> Int32
    private typealias SetFn = @convention(c) (UInt32, Float) -> Int32
    private lazy var handle = dlopen("/System/Library/PrivateFrameworks/DisplayServices.framework/DisplayServices", RTLD_LAZY)
    private lazy var getFn: GetFn? = handle.flatMap { dlsym($0, "DisplayServicesGetBrightness") }.map { unsafeBitCast($0, to: GetFn.self) }
    private lazy var setFn: SetFn? = handle.flatMap { dlsym($0, "DisplayServicesSetBrightness") }.map { unsafeBitCast($0, to: SetFn.self) }

    private var builtin: UInt32? {
        var count: UInt32 = 0
        CGGetActiveDisplayList(0, nil, &count)
        var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
        CGGetActiveDisplayList(count, &ids, &count)
        return ids.first { $0 != 0 && CGDisplayIsBuiltin($0) != 0 }
    }

    private func get(_ id: UInt32) -> Float? {
        if let f = getFn { var v: Float = 0; if f(id, &v) == 0 { return v } }
        var out: Float?
        iterateIO { svc in var v: Float = 0; if IODisplayGetFloatParameter(svc, 0, kIODisplayBrightnessKey as CFString, &v) == kIOReturnSuccess { out = v } }
        return out
    }

    private func set(_ id: UInt32, _ value: Float) -> Bool {
        if let f = setFn, f(id, value) == 0 { return true }
        var ok = false
        iterateIO { svc in if IODisplaySetFloatParameter(svc, 0, kIODisplayBrightnessKey as CFString, value) == kIOReturnSuccess { ok = true } }
        return ok
    }

    private func iterateIO(_ body: (io_service_t) -> Void) {
        var it: io_iterator_t = 0
        guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IODisplayConnect"), &it) == KERN_SUCCESS else { return }
        defer { IOObjectRelease(it) }
        while case let svc = IOIteratorNext(it), svc != 0 { body(svc); IOObjectRelease(svc) }
    }

    func dim() -> Bool {
        guard let id = builtin else { return false }
        if saved == nil { saved = get(id) ?? 0.5 }
        return set(id, 0)
    }

    func restore() -> Bool {
        guard let id = builtin, let v = saved else { saved = nil; return true }
        let ok = set(id, v)
        if ok { saved = nil }
        return ok
    }
}
