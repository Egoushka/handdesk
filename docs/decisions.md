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
