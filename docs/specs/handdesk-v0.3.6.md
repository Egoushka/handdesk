# handdesk v0.3.6: a menu you can use with hands

Feedback: "I cannot use the helper properly and it is not nice and not handy."

1. One main menu panel (1739 px per metre, 0.92 m wide, opens 0.95 m ahead): left rail of six tabs (Mode, Windows, Snips, Hands, Distance, Help), large tiles, dark glass, icons, hover and press states. Movable by its top bar with the select ray. Opened by a left wrist flip or the Menu button (which also shows the mode and link state).
2. First-run guide of five steps (shown once, re-opened from Help) and a one-page gesture sheet.
3. Less clutter: the always-on HUD and status line are gone; the status line shows only a problem; hints hide while a panel is open.
4. Checks: `tests/v06.test.ts` (layout inside the panel, 5 cm targets, no overlap, text floor, hit mapping, guide and sheet); screenshots from `web/scripts/shots.mjs`; the existing e2e smoke.
