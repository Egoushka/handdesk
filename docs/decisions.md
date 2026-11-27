# Decisions

Each entry: the choice, why, and what would reverse it. Dates are 2026-11-26.

## D1 Secure context through `adb reverse` and localhost, not a certificate
WebXR needs a secure context. A self-signed cert needs a click-through on the Quest; a local CA cannot be installed in Quest Browser;
a public HTTPS page cannot call a LAN `ws://` host (mixed content). `http://localhost` is a secure context, and the Quest 3 is
already in developer mode with adb on Yehor's Mac, so `adb reverse tcp:8787 tcp:8787` makes `localhost:8787` on the headset reach the Mac:
no certificate, no warning, and the agent stays bound to loopback. `--lan --tls-p12` is the optional route for a trusted cert on a real hostname.
Reverse if: adb reverse stops working over Wi-Fi debugging on a Horizon OS update.

## D2 WebSocket plus WebCodecs instead of WebRTC
The brief recommended WebRTC. It would pull a ~100 MB prebuilt libwebrtc into the Swift package, and ICE/DTLS adds nothing over `adb reverse` or a LAN
socket. H.264 hardware encode (VideoToolbox) and hardware decode (WebCodecs `VideoDecoder`, Chromium in Quest Browser) are the same codecs. The agent gets
no third-party dependencies and the protocol is testable. Reverse if: latency or loss over Wi-Fi needs congestion control; then swap the transport, the message set stays.

## D3 Agent serves the page itself
One command on the Mac, one URL on the headset, no hosting. Release tarball carries the binary and `web/`.

## D4 Magnify as Cmd + / Cmd - by default
Synthetic CGEvent gesture events (type 29) are undocumented and app-dependent; I could not verify them without the headset session. Cmd +/- works in browsers, editors, Preview and most apps.
The gesture-event path ships behind `--magnify=gesture` for Yehor to try.

## D5 Two-hand pinch moves the panel; one-hand L shape zooms the Mac
The brief gave two-hand spread to both panel resizing and Mac magnify. One gesture cannot be both, so the two-hand pinch stays panel manipulation and Mac zoom is a one-hand L-shape aperture change.

## D6 Scroll direction is a content delta
`dy > 0` moves content down, posted as a pixel wheel delta with no inversion (synthetic events are not re-inverted by the natural-scrolling setting). `--invert-scroll` flips it if the headset feels wrong.

## D7 Hand-tracking is an optional feature, controllers the fallback
`immersive-ar` is requested with `hand-tracking` in `optionalFeatures`, so a session still starts when hand tracking is off and the controllers drive it.

## D8 Joints in viewer space, metres
The page converts each hand's joints into head-relative space (x right, y up, -z forward) before the classifier, so swipe directions follow where the user looks.

## D9 Pairing token plus Origin check
A random token printed by `handdesk start` and stored mode 0600 gates `/ws`; the `Origin` must match `Host`. Input injection is the sensitive part, so a webpage in another tab cannot reach it.

## D10 Thresholds are starting values
Pinch 25 mm on, 40 mm off; swipe 100 mm in 500 ms; click under 600 ms and 15 mm of travel. They come from typical hand sizes, not measurements on Yehor's hands; on-headset tuning is open.

## D11 Virtual keyboard is the main typing path (new requirement, 2026-11-26)
Surface keyboard on the physical desk, because touching a real surface is what makes ten-finger typing fast; mid-air poke is the fallback. Press = downward speed peak ending at the plane, never plain collision, so resting fingers never type.
The plane comes from flat-hand calibration (lowest fingertip height). WebXR plane detection and hit-test are not guaranteed on Quest Browser, were requested but never used in the first cut, and are dropped from the session request until they are implemented.

## D12 Ukrainian typed as Unicode text, English as physical keys
Letters sent as `text` work whatever input source the Mac has active, so the headset layout and the Mac cannot disagree. Shortcuts (Cmd/Ctrl held) must be physical keys, so they go as `key` with the Latin position of the key. Switching layout on the headset never touches the Mac's input source.

## D13 Autocorrect: Gaussian key-press model plus word-list prefix
Each press scores all keys by a Gaussian around the key centre (sigma about 0.45 key width, a starting value) times a prior from the word list's prefix probabilities; the best key wins only when the press is outside the key's inner 60% (edge press), so deliberate presses are never overridden. Word lists are small bundled frequency lists (a starting vocabulary, not a full dictionary).

## D14 Agent tests are an executable, `swift run core-tests`
The Mac has only the Command Line Tools: no XCTest, and the Swift Testing macros fail to load. A small assertion harness in an executable target runs the same checks, exits 1 on a failure, and works on a stock runner too. Reverse if: a runner has full Xcode and `swift test` is wanted; the tests port over.

## D15 Gate review fixes (2026-11-26)
An independent review of the whole repo found one high correctness bug (a left button left held when a drag ended over nothing or a session dropped) and several medium ones (unbounded numbers in the agent, no connection cap, thumb typing Space anywhere, no Ukrainian full stop or apostrophe, a LaunchAgent with no web path). All fixed with tests. Not done: build attestation for release files and code signing, listed as open in THREAT-MODEL.md.

## D16 v0.2 scope: lean core of immersive and Mac-as-machine (2026-11-27)
Feedback: no in-headset instructions, hands not visible, not immersive or controllable enough, the Mac is a machine and not a screen, and the agent log was silent. The budget is limited, so each part is the lean version: a first-run overlay and a palm-up cheat sheet instead of an animated tour; four environments; handles, recenter, direct touch and one saved layout; virtual displays, window panels and a launcher on the Mac side. Deferred to one issue: Mac audio, clipboard, notifications, dictation, the animated tour, saved layouts per room. Virtual displays and window capture change the capture model, so they came before the rest of the deferred list.

## D17 First run is one overlay, not a tour
An animated tour that confirms each gesture is the better teacher, but it is the most code. The overlay names the four things that matter (point, pinch, two-hand move, palm-up cheat sheet) and closes on the first click. Reverse if: Yehor's feedback says the cheat sheet is not enough.

## D18 Visible hands are rendered from joints, not skinned
25 spheres and capsule bones from the joint poses: no asset to ship, correct per-frame, and writes depth so panels and hands occlude each other. Real-world occlusion of panels by your actual hands in passthrough needs the depth API, which Quest Browser does not give WebXR sessions; stated limit.

## D19 One saved layout, not per room
WebXR exposes no stable room or anchor identity to a web page, so a single saved layout restored on start plus recenter covers the use. Reverse if: Quest Browser ships persistent anchors.

## D20 Wi-Fi mode is wireless adb, not a certificate
`adb reverse` works over wireless adb, so `localhost` on the headset reaches the Mac over Wi-Fi and stays a secure context: no certificate, no warning, loopback bind unchanged. A public certificate for a LAN name needs DNS control and a private key on the Mac; that remains `--lan --tls-p12` for anyone who has one. The headset is pinned to 5 GHz, which wireless adb uses like any other traffic.

## D21 Sign with a persistent self-signed identity
macOS keys Screen Recording and Accessibility grants to the code requirement. An ad hoc signature changes with every build, so grants are lost; a self-signed certificate in the login keychain gives a requirement based on that certificate, so grants survive rebuilds. The script creates it once, locally; nothing leaves the Mac.

## D22 Logs never contain the token or typed text
Input logging is at debug level and records message type, key code class and text length only. The pairing token is never logged; the `open` command passes it to adb without printing it.

## D23 Windows are streams 128 and up; focus follows the touch (2026-11-27)
The video header already carries a one-byte stream id, so window streams reuse it: displays 0..127, windows 128..255, no new header. A click on a window panel activates its app before the click, which is what "focus follows the panel you touch" needs. Window input uses coordinates normalized to the window's current bounds.

## D24 Spotlight results are opened by id, never by path
`open` takes the id of a result the agent itself returned for this session, so a client cannot make the agent open an arbitrary path. The query goes to `mdfind` without a shell.

## D25 Virtual displays are only ever the agent's own
`remove` accepts only ids the agent created, and all of them go when the last client leaves, so a crashed headset cannot leave extra screens or a dark physical display (dimming restores on leave and on exit).

## D26 Wi-Fi without a cable is wireless adb; a trusted LAN certificate is deferred (2026-11-27)
The USB cable dropped mid-session, and `adb reverse` died with it. Wireless adb (D20) keeps the same `localhost` secure context over Wi-Fi with no certificate and no warning, so v0.2.2 makes it the cable-free path: `handdesk wifi` once, the agent remembers the address, reconnects after a Mac or adb restart, and re-applies the reverse. The recommended alternative, a Let's Encrypt cert for a name such as handdesk.lab.hrabovskyi.online pointing at the Mac's LAN address, needs a new homelab stack on nickel to issue a dedicated single-name cert by DNS-01 and a sanctioned way to deliver the key to the Mac; raw ssh to nickel is blocked by the box guard and the existing wildcard's key should not leave the edge. That is a separate piece of work (issue). Limit of the chosen path: after the headset restarts, wireless adb is off until one USB connection runs `handdesk wifi` again.

## D27 Retain what the agent starts (issue #5)
`AdbSupervisor(...).start()` and `PermissionWatcher().start()` were temporaries, deallocated at once, so their timers never fired: no reverse after a restart and no permission log. They are now held in globals. `handdesk open` also sets the reverse itself and fails loudly if it cannot.

## D28 Window panels were out of view and the list was hard to find (2026-11-27)
Live probe of the Mac agent: window listing, ScreenCaptureKit window capture and the `windowStreams` message all work (frames arrived for a window stream). So the agent was not the cause. Likely causes on the page (found by reading the code; not reproduced in a headset): `arrange` placed every window panel in the display row at 1.8 m, up to about 2 m to the side of a 2.4 m wide display, so the panel was outside the field of view; the launcher showed only the first 6 windows in a crowded list; and the log showed `windows: 0` on every subscribe because the launcher was never used. Fix: window panels spawn 1.25 m in front of the head and are never part of the row recenter; the launcher lists 8 windows with a `[panel]` mark and an empty-state line. Also hardened focus: `NSRunningApplication.activate(options:)` is only a request and on macOS 14+ a background process often cannot take focus, so the agent now raises the exact window and sets the app frontmost through the Accessibility API (already required for input), and falls back to `activate`. Window activation is synchronous (1 s per-app timeout) because the click that follows must land on the raised window. Limits: only on-screen windows of normal apps are listed (other Spaces, minimised and full-screen windows are not), and `_AXUIElementGetWindow` is a private but long-stable symbol.

## D29 Real hands by depth sensing, skinned hands from the generic profile (2026-11-27)
Supersedes the "stated limit" in D18: Quest Browser does offer WebXR `depth-sensing`. Passthrough sessions request it as an optional feature (gpu-optimized first); three.js 0.170 renders the depth mesh when it is granted, so real hands and the desk hide virtual panels behind them. The mode `real` draws nothing for hands. Not verifiable without the headset: whether Quest Browser grants it on this firmware (the Scene permission may be needed). The skinned model is the 94 KB generic hand glb per side, copied to `web/public/hands` (MIT, licence file alongside) so it works offline over `adb reverse`.

## D30 Extra gestures are a separate detector (2026-11-27)
`gesture/extra.ts` reads the same viewer-space frames as the classifier but does not touch it, so the pointer work can change independently. It emits events; shortcut events become key messages (`gesture/extraMessages.ts`), fist drag reuses the pinch-drag mapping, spread scales the panel in the gaze, and title-strip move rides on the existing pinch drag. Thresholds are starting values in `gesture/extraConfig.ts` (D10). Snap detection from hand joints is the least reliable of the set: hand tracking runs at about 30 to 60 Hz and a snap is a few frames long; expect to tune `snapSpeed` or drop it.

## D31 The hand is a virtual glove from our own joints (v0.3.3, 2026-11-27)
Feedback on v0.3.1: the real/skinned hands looked bad and Yehor wants a virtual hand. The default is now `virtual`: a rim-lit translucent glove (tapered capsules, joint spheres, a palm sheet) built from the same 25 joints the gestures use, so it works identically in passthrough and VR and needs no model file. Real-hand occlusion (depth sensing) is requested only in `real` mode, since it hid the glove and panels. A held pose (300 ms, then a 200 ms fade) stops tracking flicker from blinking the hand. The saved-mode key changed to `handMode2` so the old default does not stick. Reverse if: the glove reads as too ghostly on the headset; tune `opacity` and the rim in `hands/glove.ts`.

## D32 Snips are uv crops of the source texture (v0.3.3; v0.3.2 was taken by the https release)
A snip is a second mesh on the source's own canvas texture with the uv cut to the region: no second capture, always live. Pointing is mapped by `Panel.crop` inside `intersect`, so picking, direct touch and the Mac coordinates all agree without special cases. The gesture is thumb to ring finger because index, middle and both are taken by click, right click and scroll; the menu button is the fallback. Only pinned snips persist, per source key, like layouts (two windows of one app share a key). Open: snips of a closed window are hidden until the panel returns; a snip of a snip is not supported.

