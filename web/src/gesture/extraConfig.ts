/** Thresholds of the extra gestures (v0.3). All starting values: tune on the headset. Distances in metres, times in ms. */
export const extraConfig = {
  /** a finger is extended when its tip is this many times further from the wrist than its first knuckle */
  extendedRatio: 1.4,
  /** the thumb is out when its tip is this far from the index knuckle */
  thumbOutDist: 0.055,
  /** how much of the palm normal must point the way a gesture needs (cosine) */
  palmFacing: 0.6,

  /** two-finger flick: back (left) and forward (right) */
  flickWindowMs: 250,
  flickDistance: 0.12,
  flickAxisRatio: 2,
  flickCooldownMs: 800,

  /** open palm pushed away from you: Mission Control */
  pushWindowMs: 300,
  pushDistance: 0.15,
  pushCooldownMs: 1200,

  /** open palm facing down, dropped: hide the window */
  dropWindowMs: 250,
  dropDistance: 0.12,
  dropCooldownMs: 1200,

  /** fist held this long starts a drag; opening the hand drops */
  fistHoldMs: 400,

  /** thumb up with the fingers curled, held: Enter */
  thumbsUpHoldMs: 350,
  thumbsUpRise: 0.05,
  thumbsUpCooldownMs: 1200,

  /** two open palms facing forward, held, then moved apart or together: scale the panel you look at */
  spreadHoldMs: 300,
  spreadDeadZone: 0.08,

  /** snap: thumb and middle finger touch, then the middle fingertip leaves fast */
  snapContact: 0.02,
  snapWindowMs: 160,
  snapSpeed: 1.2,
  snapCooldownMs: 1500,

  /** pinch-hold on the top strip of a panel (fraction of its height) moves the panel */
  titleBand: 0.07,
} as const;

export type ExtraConfig = { -readonly [K in keyof typeof extraConfig]: number };
