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

## D16 v0.2 ships onboarding, hands, space and reliability; the headless-Mac list is v0.3 (2026-11-27)
The feedback has two halves: the headset experience (instructions, visible hands, immersion, control) and "treat the Mac as a machine behind the headset". The first half and the invisible-agent problem are cheap and certain, so they ship first. Window-per-panel capture, CGVirtualDisplay, launcher, audio, clipboard, notifications and dictation each need a Mac-side private or permissioned API (CGVirtualDisplay is undocumented, audio needs its own capture permission) and a design for the headset side; bundling them would delay the fixes Yehor asked for. Reverse if: the headless Mac becomes the main use; start v0.3 with virtual displays since it changes the capture model.

## D17 Tour confirms by doing, using the classifier's own events
A step is done when the real classifier emits the event the step teaches. That makes the tour a live test of tracking on his hands, and a gesture that never completes is visible straight away. A skip is always in the palm-up menu.

## D18 Visible hands are rendered from joints, not skinned
25 spheres and capsule bones from the joint poses: no asset to ship, correct per-frame, and writes depth so panels and hands occlude each other. Real-world occlusion of panels by your actual hands in passthrough needs the depth API, which Quest Browser does not give WebXR sessions; stated limit.

## D19 Layouts are saved by slot, not by room
WebXR exposes no stable room or anchor identity to a web page. A named slot (default, desk, couch) restored on start, plus recenter, covers the use without anchors. Reverse if: Quest Browser ships persistent anchors.

## D20 Wi-Fi mode is wireless adb, not a certificate
`adb reverse` works over wireless adb, so `localhost` on the headset reaches the Mac over Wi-Fi and stays a secure context: no certificate, no warning, loopback bind unchanged. A public certificate for a LAN name needs DNS control and a private key on the Mac; that remains `--lan --tls-p12` for anyone who has one. The headset is pinned to 5 GHz, which wireless adb uses like any other traffic.

## D21 Sign with a persistent self-signed identity
macOS keys Screen Recording and Accessibility grants to the code requirement. An ad hoc signature changes with every build, so grants are lost; a self-signed certificate in the login keychain gives a requirement based on that certificate, so grants survive rebuilds. The script creates it once, locally; nothing leaves the Mac.

## D22 Logs never contain the token or typed text
Input logging is at debug level and records message type, key code class and text length only. The pairing token is never logged; the `open` command passes it to adb without printing it.
