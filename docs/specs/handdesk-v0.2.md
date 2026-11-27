# handdesk v0.2 spec

First headset session feedback: no instructions in the headset, hands not fully tracked or visible, the space not immersive or controllable enough, the Mac treated as a screen rather than a machine, and an agent log that showed nothing.
This is the lean core of each. Deferred (GitHub issue): Mac audio, clipboard, notifications, dictation, animated tour, saved layouts per room.

## Scope

| # | Item | Where |
|---|---|---|
| 1 | First-run overlay and a palm-up cheat sheet; live hints; status strip (link, latency, fps, permission problems) | `web/src/onboarding`, `web/src/app` |
| 2 | Both hands drawn from all 25 joints (spheres and capsules), pinch indicator, tracking-lost state | `web/src/hands`, `web/src/app` |
| 3 | Environments, panel handles (place, curve, scale), recenter, direct fingertip touch, saved layout | `web/src/space`, `web/src/app` |
| 4 | Virtual displays added and removed from the headset, optional dimming of the physical display; each macOS window as its own panel with click focus; launcher (running apps, Spotlight through the virtual keyboard) | `agent/`, `web/src/mac` |
| 5 | Structured log, reconnect, adb supervisor, Wi-Fi mode (wireless adb), `handdesk open`, stable signing | `agent/`, `scripts/` (done in the first commit of this PR) |

## Protocol additions (version 2, backward compatible)

Already implemented: `hello` has `agent`, `permissions {screenRecording, accessibility}`; client `ping {t}` gets `pong {t}`; client `log {level, message}`.

New, window streams: stream ids 128..255 are windows. The video header's byte 1 is the stream id (displays keep their index 0..127).
- Client `{"type":"windows"}` asks for the list; the server also pushes it when it changes (poll 1 s): `{"type":"windows","windows":[{"id":<CGWindowID>,"app":"Safari","pid":123,"title":"...","x":0,"y":0,"width":900,"height":700}]}`. Only normal windows (layer 0, on screen, at least 100x100 points, not handdesk's own) of regular apps.
- Client `subscribe` gains `"windows":[<CGWindowID>,...]` next to `displays`. The server answers `{"type":"windowStreams","streams":[{"windowId":123,"stream":128,"width":900,"height":700,"pixelWidth":1800,"pixelHeight":1400}]}` (sent again when a window is resized) and starts one capture per window (ScreenCaptureKit window filter). A window that closes stops its stream and is dropped from the next `windowStreams`.
- Client `move` and `button` may carry `"window": <CGWindowID>` instead of `display`; `x,y` are then normalized to that window's current bounds. A left or right button down on a window activates its app (`NSRunningApplication.activate`) first: focus follows the panel you touch.
- `scroll`, `magnify`, `swipe`, `key`, `text` act on whatever is focused.

New, virtual displays:
- Client `{"type":"virtualDisplay","action":"add","width":2560,"height":1440,"name":"handdesk"}` creates a CGVirtualDisplay (60 Hz, HiDPI off). `{"type":"virtualDisplay","action":"remove","id":<display id>}` removes one the agent created (never a physical one). The server answers `{"type":"virtualDisplay","ok":true|false,"id":..,"error":".."}` and then `{"type":"displays","displays":[...same DisplayInfo list as hello...]}`, also pushed whenever the display configuration changes. All virtual displays are removed when the last client leaves.
- Client `{"type":"dimPhysical","on":true|false}` sets the built-in display's brightness to 0 and restores the remembered value on `off`, on client leave and on agent exit. Best effort: the reply is `{"type":"dimPhysical","ok":bool}`.

New, launcher:
- Client `{"type":"apps"}` -> `{"type":"apps","apps":[{"name":"Safari","bundleId":"com.apple.Safari","pid":123,"active":false}]}` (regular running apps, also pushed when it changes).
- Client `{"type":"app","action":"launch"|"activate"|"quit","bundleId":"com.apple.Safari"}`. Launch and activate use NSWorkspace; quit asks the app to terminate politely.
- Client `{"type":"spotlight","query":"saf"}` -> `{"type":"spotlightResults","query":"saf","results":[{"id":1,"name":"Safari","kind":"app","path":"/Applications/Safari.app"}]}`: at most 12 results from `mdfind` run without a shell, query at most 64 characters, applications first.
- Client `{"type":"open","id":1}` opens that result of the last spotlight answer on this session (by id only, never by path).

## Onboarding

- First run (no `handdesk.intro.done` in localStorage) shows an overlay panel in front of the user: "Point with your hand. Pinch to click. Pinch both hands to move a window. Hold your left palm up for the cheat sheet." It closes on the first pinch click and sets the flag.
- Cheat sheet: the left palm facing up for 400 ms shows a panel by the hand listing every gesture (the table in the v0.1 spec) and buttons: Intro, Recenter, Environment, Save layout, Keyboard, Launcher, Displays. It closes when the palm turns away.
- Live hints near the dominant hand: a pinch that has not closed, a three-finger pose held without moving, an L shape without a gap change, one hand pinching while the other is open.
- Status strip above the panels: link state, latency (ms), frames per second, permission problems from `hello`.

## Hands

25 joint spheres plus capsule bones along the WebXR skeleton, writing depth so hands and panels hide each other correctly. A ring between thumb and index shows pinch strength. The far ray is drawn only for a hand pointing at a panel beyond arm's reach. No hand for 600 ms shows "Hands not tracked: bring them into view" and resets the classifier.

## Space

- Environments: `passthrough`, `dim` (passthrough under a 55 percent dark veil), `night` (procedural star sky), `grid` (v0.1 scene). The last choice is remembered.
- Handles: when a hand is within 30 cm of a panel, corner handles (scale), an edge handle (curve) and a top bar (move) appear; a far pinch on a handle drags it. The two-hand grab from v0.1 stays.
- Recenter: from the cheat sheet and by holding controller button B for 1 s; every panel returns in front of the head at the layout's saved offsets.
- Direct touch: a fingertip within 3 cm in front of a panel that is within 0.7 m shows a dot; crossing the plane presses the left button there, staying drags, pulling back releases; a quick cross-and-return is a click.
- Layout: panel centre, yaw, width, curve and the keyboard plane are saved to localStorage (slot `default`) from the cheat sheet, and restored on session start.

## Launcher and Mac panels

The launcher is a panel with a text field (typed on the virtual keyboard; while it has focus the keyboard types into it, not the Mac), the running apps, the Spotlight results and the windows list. Clicking an app activates it, a Spotlight result opens it, a window adds a window panel, a display row adds or removes a virtual display. The Displays section also has "Dim Mac screen".

## Comfort and reliability (in the first commit)

Structured JSON log to `~/Library/Logs/handdesk.log`, adb supervisor, `handdesk wifi`, `handdesk open`, `scripts/sign-mac.sh` with a persistent self-signed identity (D21), page opens into the session with `offerSession` when the browser has it.

## Acceptance checks (machine-run)

| # | Check | Command |
|---|---|---|
| B1 | Intro flag, palm-up detection (hold time, both hands, negatives), hints | `cd web && npm test` |
| B2 | Tracking state and hand rig (bones use only the 25 joints, pinch strength) | `cd web && npm test` |
| B3 | Direct touch: press, drag, release, click, out of reach and behind-panel negatives | `cd web && npm test` |
| B4 | Layout store and recenter; handles (scale, curve, move) maths | `cd web && npm test` |
| B5 | Mac messages: window and display and app and spotlight message handling, launcher state | `cd web && npm test` |
| B6 | Headless page: `offerSession` offered when present, Enter surface otherwise | `cd web && npm run e2e` |
| C1 | Logger, adb parsers, hello and ping/pong (done) | `cd agent && swift run core-tests` |
| C2 | Window list filtering and bounds mapping, window input routing, stream ids, virtual display request validation, app and spotlight message validation (limits, ids only) with a fake system | `cd agent && swift run core-tests` |
| C3 | Release build | `cd agent && swift build -c release` |
