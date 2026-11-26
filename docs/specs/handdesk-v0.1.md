# handdesk v0.1 spec

An immersive Mac desktop on a Meta Quest 3, driven by hand tracking (controllers as fallback).
Meta's Virtual Display forwards only pointer move/click/scroll and keyboard. handdesk adds the gestures it lacks:
pinch-zoom (magnify), three-finger Space swipes, Mission Control, smooth scroll, and a desktop you can grab, resize and curve.

## Parts

| Part | Where | What |
|---|---|---|
| Page | `web/` (TypeScript, Vite, three.js) | WebXR in the Quest Browser. No APK. Renders each Mac display as a panel, reads hand joints, classifies gestures, sends input events. |
| Agent | `agent/` (SwiftPM, macOS 14+) | Captures displays (ScreenCaptureKit), encodes H.264 (VideoToolbox), serves the page and a WebSocket, injects input (CGEvent). Runs as a LaunchAgent. |
| Classifier | `web/src/gesture/` | Pure TypeScript, no DOM. Joint frames in, gesture events out. |

## Transport

One HTTP port (default 8787) serves `web/dist` and a WebSocket at `/ws?t=<token>`.
Video is H.264 Annex B over the WebSocket, decoded in the page with WebCodecs. Input is JSON text frames.
Security: the agent binds `127.0.0.1` by default; the Quest reaches it as `http://localhost:8787` through `adb reverse`
(localhost is a secure context, so WebXR works with no certificate). `--lan` binds all interfaces and needs `--tls-p12`
(a publicly trusted cert for a name that resolves to the Mac). `/ws` needs the pairing token and a same-host `Origin`.

### Server to client

- Text `{"type":"hello","version":1,"displays":[{"id":<CGDirectDisplayID>,"name":"","x":0,"y":0,"width":1512,"height":982,"pixelWidth":3024,"pixelHeight":1964}]}`. `x,y,width,height` are global points; display index = array position.
- Text `{"type":"error","message":"..."}`.
- Binary video: byte 0 = `0x01`; byte 1 = display index; byte 2 = flags (bit 0 = keyframe); bytes 3..10 = u64 big-endian timestamp in microseconds; the rest is one Annex B access unit. Keyframes carry SPS and PPS. The page derives the codec string `avc1.PPCCLL` from SPS bytes 1..3.

### Client to server (text JSON)

| Message | Fields | Meaning |
|---|---|---|
| `subscribe` | `displays: number[]` | Display indexes to stream. Default `[0]`. A newly subscribed display sends a keyframe first. |
| `move` | `display, x, y` | Pointer to normalized position (0..1, top-left origin). |
| `button` | `display, button: "left"\|"right", down, x, y` | Press or release at that position. |
| `scroll` | `dx, dy` | Pixels. Content delta: `dy > 0` moves content down (touch-drag direction). |
| `magnify` | `delta` | Natural-log zoom ratio; `> 0` zooms in. |
| `swipe` | `direction: "left"\|"right"\|"up"\|"down"` | Three-finger swipe. |
| `key` | `code, down, modifiers?: ("cmd"\|"ctrl"\|"alt"\|"shift")[]` | Physical key by DOM `KeyboardEvent.code` (`KeyA`, `Digit1`, `Enter`, `Backspace`, `ArrowLeft`, `F1`, ...), mapped on the Mac to a virtual key code and posted as a CGEvent keyboard event with the given modifier flags. A lone modifier key (`MetaLeft`, `ControlLeft`, `AltLeft`, `ShiftLeft`) posts a flags-changed press. |
| `text` | `text` | Insert this string (CGEvent keyboard event with a Unicode string; works whatever input source the Mac has active). Used for Ukrainian letters and accepted suggestions. |

## Gesture map

| Gesture | Hand | Controller | Mac result |
|---|---|---|---|
| Point | hand ray | controller ray | pointer move |
| Thumb-index pinch, release without moving | tap | trigger tap | left click (double pinch = double click) |
| Pinch, move, release | drag | trigger hold, move | mouse down, drag, up |
| Thumb-middle pinch tap | right pinch | A / X button | right click |
| Thumb touches index and middle, move hand | two-finger pinch-drag | thumbstick up/down | smooth scroll |
| L shape (thumb and index out, others curled), change the gap | aperture | none | magnify (Cmd + / Cmd - steps; real gesture event behind `--magnify=gesture`) |
| Index, middle, ring out, swipe 10 cm or more | three-finger swipe | thumbstick flick | left/right = Ctrl-Left/Right (Spaces); up = Ctrl-Up (Mission Control); down = Ctrl-Down (App Expose) |
| Both hands pinching | two-hand grab | squeeze (one or both) | moves, turns and resizes the panel (hands apart = bigger); no Mac event |
| none | menu | B / Y button | Mission Control |

## Virtual keyboard

The main typing path. The real Bluetooth keyboard still works unchanged and is an option.

- Surface mode: a ten-finger keyboard laid on the physical desk. Plane from WebXR `plane-detection` or `hit-test` when the browser grants it,
  else calibrated by laying a flat hand on the desk (palm height becomes the plane). The desk gives touch feedback, which is what allows fast typing.
- Poke mode: the same keyboard floating in mid air, for when there is no surface; a deeper, slower press (fingertip crossing the plane).
- Press detection (pure TypeScript, per fingertip, 10 fingers): a press is a downward fingertip speed peak that ends at the plane
  (height under contact height) and reverses or stops; the key is the one under the fingertip at the moment of contact.
  A finger resting on the plane (low speed, no recent downward peak) never presses. Two fingers pressing at once give two keys. Thumbs press Space.
  Press feedback: key highlight and a short click sound (WebAudio).
- Layouts: US English and Ukrainian (ЙЦУКЕН), switched by the globe key on the keyboard or a left-hand tap on the keyboard's left edge. Modifiers Cmd, Ctrl, Opt, Shift are sticky (one tap arms for the next key, double tap locks) so Cmd-shortcuts work.
- Sending: letters in English go as `key`; Ukrainian letters go as `text` (independent of the Mac input source); with Cmd or Ctrl armed the physical key goes as `key` with modifiers.
  Backspace, Enter, Tab, Escape, arrows always go as `key`.
- Speed aids: a local suggestion strip (small word list per language, frequency ranked) and autocorrect that snaps an edge press to the likely key
  using a key-press probability model (Gaussian over key centres, ranked with the word list prefix). Swipe a fingertip across the strip, or tap a suggestion, to accept; acceptance sends `text` for the rest of the word. No cloud.

## Acceptance checks (machine-run)

| # | Check | Command |
|---|---|---|
| A1 | Classifier: click, double click, drag, right click, scroll, magnify, three-finger swipe (4 directions), two-hand grab, controller trigger/squeeze/stick, each from synthetic joint fixtures, plus negative cases | `cd web && npm test` |
| A2 | Panel geometry: ray to panel UV for flat and curved panels | `cd web && npm test` |
| A3 | Protocol: message encode/validate, video frame parse | `cd web && npm test` |
| A9 | Press detection on synthetic fingertip trajectories: tap counts, resting finger does not, two fingers give two keys, thumbs give space, poke mode | `cd web && npm test` |
| A10 | Autocorrect: an edge press maps to the intended key in common EN and UK words; suggestions | `cd web && npm test` |
| A11 | Key mapping: DOM key code to CGEvent key code and modifier flags, `text` and `key` message to poster calls | `cd agent && swift test` |
| A4 | Agent event mapping: each message to the exact poster call sequence with a fake `EventPoster` | `cd agent && swift test` |
| A5 | Agent framing: HTTP request parse, WebSocket handshake and frame codec, token check | `cd agent && swift test` |
| A6 | Agent builds release | `cd agent && swift build -c release` |
| A7 | Headless: page loads, Enter AR requests `immersive-ar` with `hand-tracking` (emulated `navigator.xr`) | `cd web && npm run e2e` |
| A8 | Web type check and production build | `cd web && npm run check && npm run build` |

CI runs A1-A3, A7-A10 (web) on ubuntu and A4-A6, A11 on macos-latest.

## Out of scope for v0.1

Virtual display creation (CGVirtualDisplay), audio, clipboard, HEVC, WebRTC, on-headset tuning of thresholds.
