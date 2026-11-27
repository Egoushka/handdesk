# handdesk v0.2 spec

Feedback from the first headset session: there were no instructions in the headset, hands were not fully tracked (or visible), the space was not immersive or controllable enough, and the agent log showed nothing after start.
v0.2 fixes those. Window capture, virtual displays, launcher, audio, clipboard, notifications and dictation (the "Mac as a headless machine" list) are v0.3.

## Scope

| # | Item | Where |
|---|---|---|
| 1 | In-headset first-run tour; palm-up menu and cheat sheet; live hints for half-made gestures; readable status (link, latency, fps, permission problems) | `web/src/onboarding`, `web/src/app` |
| 2 | Both hands drawn from all 25 joints, fingertip glow on contact, pinch-strength ring, ray only when pointing at something far, hands occlude panels by depth, a clear tracking-lost state | `web/src/hands`, `web/src/app` |
| 3 | Environments (passthrough, dim passthrough, four VR scenes), grab handles, saved layouts restored on start, recenter, direct touch on a panel within arm's reach | `web/src/space`, `web/src/app` |
| 5 | Structured agent log, reconnect, adb supervisor and Wi-Fi mode, page opens into the session, stable code signing so permission grants survive rebuilds | `agent/`, `scripts/` |

## Protocol additions (version 2, backward compatible)

- `hello` gains `"agent":"0.2.0"` and `"permissions":{"screenRecording":bool,"accessibility":bool}`. `version` is 2.
- Client `{"type":"ping","t":<number>}`; server answers `{"type":"pong","t":<same number>}` at once. The page shows the round trip as latency.
- Client `{"type":"log","level":"debug"|"info"|"warn","message":"..."}` lets the page put a line in the agent log (capped at 256 characters, rate limited); used for session start, session end and gesture events at debug.

## Onboarding

- First run (no `handdesk.tour.done` in localStorage) starts the tour when the session opens. Steps, in order: point, pinch (click), drag, two-finger scroll, L-shape zoom, three-finger swipe, two-hand grab, keyboard. Each step shows an animated ghost hand playing the pose and moves on when the classifier emits the matching event ("do it to continue"). A fist-free escape: the palm-up menu has Skip.
- Palm-up menu: the left palm facing up for 400 ms opens a panel by the hand with Cheat sheet, Tour, Recenter, Environment, Layouts (save, restore), Keyboard and Quit session. It closes when the palm turns away.
- Cheat sheet: a panel listing every gesture with a small hand picture.
- Live hints near the dominant hand when a gesture is half-made: a pinch that has not closed ("close the pinch to click"), a three-finger pose held without moving ("swipe 10 cm"), an L shape with no change ("open or close the gap to zoom"), one hand pinching while the other is open ("pinch with both hands to move the panel").
- Status strip above the panels: link state, latency (ms), video frames per second, permission problems from `hello` ("Screen Recording is not granted on the Mac").

## Hands

- Each hand is drawn as 25 joint spheres plus capsule bones along the WebXR hand skeleton, from the joint poses of the frame. They write depth, so a hand in front of a panel hides it and a panel in front of a hand hides the hand.
- Fingertip glow: a tip brightens as it nears a panel, the keyboard plane or the thumb. Pinch strength: a ring between thumb and index tips whose size follows the gap.
- A ray is drawn only for a hand that is pointing at a panel farther than arm's reach.
- Tracking lost: no hand for 600 ms shows a message in front of the user ("Hands not tracked: bring them into view") and clears when a hand returns. After 600 ms the classifier is reset so no gesture is left half-held.

## Space

- Environments: `passthrough`, `dim` (passthrough under a 55 percent dark veil), `studio`, `night`, `horizon`, `grid`. Chosen from the menu; the last choice is remembered.
- Panel handles: corner handles and a curve handle appear when a hand is within 30 cm of a panel; grabbing a handle with a pinch resizes or curves it.
- Layouts: panel positions, sizes, curves, keyboard plane and environment are saved to localStorage under a slot name (`default`, `desk`, `couch`) and restored on session start. Restore is by slot, not by detected room: WebXR gives no stable room id.
- Recenter: moves every panel in front of the head, at the saved distance and height offsets; from the menu and from controller button B held for 1 second.
- Direct touch: a fingertip within 3 cm in front of a panel that is within 0.7 m shows a touch dot; crossing the panel plane presses the left button at that point, staying drags, pulling back releases; a quick cross-and-return is a click. Works alongside the far pinch ray.

## Comfort and reliability

- Page: opens into the session with `navigator.xr.offerSession` when the browser has it (the browser's own Enter button), else a large Enter surface that any click or hand pinch in the 2D page triggers. Reconnects on its own (v0.1). The session request stays inside a user activation; WebXR does not allow starting a session with none.
- Agent: structured log (one JSON object per line: time, level, event, fields) to `~/Library/Logs/handdesk.log` and stdout; events `start`, `session_open`, `session_close`, `subscribe`, `permission_change`, `adb`, `error`, and with `--log-level debug` each input message. Rotates at 5 MiB, keeping one old file. No token, no typed text in any line (key and text messages log only their length and key code class).
- Agent: an adb supervisor re-applies `adb reverse` for every connected device (USB or Wi-Fi serial) every 10 s and logs changes.
- Wi-Fi mode: `handdesk wifi` (with the headset on USB once) runs `adb tcpip 5555`, reads the headset's Wi-Fi address and runs `adb connect`. After that the same `adb reverse` gives `localhost` on the headset over Wi-Fi: still a secure context, still no certificate. `--lan --tls-p12` stays for a real trusted name (D1) and is documented as the non-adb route.
- `handdesk open` runs `adb shell am start -a android.intent.action.VIEW -d <url> com.oculus.browser` for every device without printing the token.
- Signing: `scripts/sign-mac.sh` signs the built binary with a persistent self-signed code-signing identity ("handdesk local") in the login keychain, creating it on first use, so the code requirement (and the Screen Recording and Accessibility grants) survives rebuilds. Falls back to ad hoc signing with a stable identifier and says that grants may need renewing.

## Acceptance checks (machine-run)

| # | Check | Command |
|---|---|---|
| B1 | Tour state machine: each step advances only on its event, skip, resume, completion flag | `cd web && npm test` |
| B2 | Hints: each half-made gesture yields its hint; completed gestures yield none | `cd web && npm test` |
| B3 | Palm-up detection with hold time, both hands, negatives | `cd web && npm test` |
| B4 | Tracking state: lost after 600 ms, restored on return, classifier reset signal | `cd web && npm test` |
| B5 | Direct touch: press, drag, release, click, out-of-reach, behind-panel negatives | `cd web && npm test` |
| B6 | Layout store: save, restore, slots, bad data ignored, recenter keeps offsets | `cd web && npm test` |
| B7 | Hand rig: bones reference only the 25 joints and connect them; pinch strength; glow | `cd web && npm test` |
| B8 | Stats: latency from pong, fps, permission messages | `cd web && npm test` |
| B9 | Headless page: offers a session through `offerSession` when present and shows the Enter surface when not | `cd web && npm run e2e` |
| C1 | Agent logger: JSON lines, levels, rotation, no secrets | `cd agent && swift run core-tests` |
| C2 | Agent: hello fields, ping to pong, log message handling and limits | `cd agent && swift run core-tests` |
| C3 | Agent: adb command builders (reverse, tcpip, connect, open) and device parsing | `cd agent && swift run core-tests` |
| C4 | Agent release build; the sign script runs on the Mac and the binary verifies | `cd agent && swift build -c release && scripts/sign-mac.sh` |
