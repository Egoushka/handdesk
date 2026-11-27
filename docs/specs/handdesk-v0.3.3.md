# handdesk v0.3.3 spec: a virtual hand and snips

Feedback after v0.3.1: "hand is bad, I want it virtual", and "I want to interact visually with a screen and take parts of it".

## Acceptance checks (all in `web/tests/v032.test.ts`, synthetic, no headset)

1. **Virtual hand.** Setting `virtual | real | skinned | joints`; default `virtual` in passthrough and VR; `real` in VR falls back to `virtual`. The saved key is `handdesk.handMode2`, so a v0.3.1 choice does not override the new default. Depth sensing (real-hand occlusion) is requested only when the saved mode is `real`.
   - A glove (solid, slightly translucent, rim-lit) follows all 25 joints; tips glow near a panel; a soft shadow falls on the panel under the palm and fingertips (`hoverShadows`: only in front, within 25 cm, darker when closer).
   - `PoseHold`: a hand that stops being tracked keeps its last pose, fully drawn, for 300 ms, then fades over 200 ms; a returning hand fades in over 100 ms.
2. **Snips.** Thumb to ring finger (index and middle away) and drag, or the menu's "Snip a region" and then a normal pinch-drag, draws a live outline rectangle on a display or window panel; release cuts it out as a floating panel sharing the source texture with cropped uvs (no extra capture).
   - A hit on a snip is reported in source coordinates (`Panel.crop`, `toSource`); window snips report their window; direct touch is mapped the same way.
   - Handles: scale and move like any panel; `pin` (locks and saves) and `close` above the top edge. Palm menu, "Snips": draw, close all, per-snip pin and close.
   - Pinned snips are saved per source (`display:N` or `window:App`) in `handdesk.snips` and come back with the source panel.
