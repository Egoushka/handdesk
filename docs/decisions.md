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
