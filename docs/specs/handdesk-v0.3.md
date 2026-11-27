# handdesk v0.3 spec, part B: real hands, window panels, more gestures

Feedback after v0.2: no separate window panels appeared, hands should look real or be skinned, and a few more gestures are wanted. Part A (pointer ray, panel size, modes, HUD) is a separate PR.

## Scope and acceptance checks

1. **Hands.** A setting `real | skinned | joints`, saved in localStorage, cycled from the palm menu. Passthrough defaults to `real`, VR to `skinned`; `real` in a VR scene shows `skinned`.
   Passthrough sessions request `depth-sensing` (optional) so three.js draws real-world depth first and real hands hide panels behind them. Skinned hands are the generic hand glb from `@webxr-input-profiles/assets`, served from `/hands/`.
   Checks: `hands/mode` unit tests (cycle, persistence, fallback); `sessionInit` test (AR asks for depth sensing, VR does not).
2. **Window panels.** The agent lists on-screen windows of normal apps; the launcher lists up to 8 with `[panel]` marks and says "none on screen" when empty; one tap makes a window its own panel, in front of the head. Touching a window panel, or adding it, brings that one Mac window forward (client message `raise`, Accessibility raise then app frontmost).
   Checks: core-tests for `raise` decoding, the command, and `windowActivator`; `windowPanel` and launcher tests; live probe of window list, `windowStreams` and video frames over a real session.
3. **Gestures** (all thresholds in `gesture/extraConfig.ts`): two-finger flick left/right = back/forward (Cmd [ / Cmd ]); open palm pushed away = Mission Control; fist held = drag; open palm facing down flicked down = hide window (Cmd H); two open palms facing away, spread or close = scale the panel in the gaze; pinch-hold on a panel's top strip = move it; snap = screenshot (Cmd Shift 3); thumb up = Enter. Listed in the headset under menu, "More gestures".
   Checks: synthetic-joint tests for every gesture and for near misses (slow, diagonal, wrong palm direction, short hold).
