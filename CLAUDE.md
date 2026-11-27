# handdesk

Immersive Mac desktop on Quest 3 by hand tracking. Read `docs/specs/handdesk-v0.1.md` (contract and acceptance checks) and `docs/decisions.md` (why) first.

- `web/` TypeScript + Vite + three.js. `src/gesture` and `src/keyboard` stay pure (no DOM, no three): they are unit-tested on synthetic joints (`tests/fixtures.ts`). Fast tier: `cd web && npm test`. Full: `npm run check && npm test && npm run build && npm run e2e` (devbox: `export PLAYWRIGHT_BROWSERS_PATH=/home/node/work/.devbox/ms-playwright`).
- `agent/` SwiftPM, macOS only. `HandDeskCore` has no capture or CGEvent code: it is tested with a fake `EventPoster` by `swift run core-tests` (no XCTest on a Command-Line-Tools Mac). Build and test over `ssh mac` (rsync `agent/` to a scratch dir, no sudo). Never open a `/ws` session in a test: it triggers the Screen Recording prompt.
- The wire protocol lives in the spec, `web/src/protocol.ts` and `agent/Sources/HandDeskCore/Messages.swift`: change all three together. A test reads the Swift key table to prove every virtual key has a Mac key code.
- The canvas must stay under `#ui` (z-index, pointer-events none), or a desktop click never reaches the Enter buttons.
- Thresholds in `gesture/config.ts` and `keyboard/press.ts` are starting values; tune on the headset, not in tests.
- Window panels spawn near the head (`space/windows.ts`) and are not part of `arrange`; the display row is the only thing recenter moves. Raising a window uses the Accessibility API (`RealSystem.raise`), synchronously, because the click right after must hit it. Probe a live agent with a Node script over `ws://localhost:8787/ws?t=<token>` (header `Origin: http://localhost:8787`), read the token from the file, never print it.
- The v0.3 gestures live in `gesture/extra.ts` (+ `extraConfig.ts`), separate from the classifier. The test fixture hand is a right hand lying palm up; tests mirror and rotate it (`tests/v03.test.ts`).
- Skinned hand meshes are in `web/public/hands` and served from `/hands/`; the agent's static server falls back to `application/octet-stream` for `.glb`, which three.js accepts.
- Installing on the Mac: `scripts/sign-mac.sh` only signs (`--show-bin-path` does not build), so run `swift build -c release` and `npm run build` (node is in `/opt/homebrew/bin`, not on the ssh PATH) first, then `launchctl kickstart -k gui/$(id -u)/online.hrabovskyi.handdesk`. Check the new build with the `raise_result` style log events, not the binary's mtime.
