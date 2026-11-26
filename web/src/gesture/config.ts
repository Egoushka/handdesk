/** Starting values (decision D10), not measured on the target user's hands. Metres and milliseconds. */
export interface GestureConfig {
  pinchOn: number;
  pinchOff: number;
  clickMaxMs: number;
  dragStart: number;
  swipeDistance: number;
  swipeMaxMs: number;
  scrollGain: number;
  magnifyHoldMs: number;
  magnifyDeadband: number;
  extendedRatio: number;
  thumbExtendedRatio: number;
  stickDeadzone: number;
  stickScrollPxPerSec: number;
  stickFlickOn: number;
  stickFlickOff: number;
}

export const defaultGestureConfig: GestureConfig = {
  pinchOn: 0.025,
  pinchOff: 0.04,
  clickMaxMs: 600,
  dragStart: 0.015,
  swipeDistance: 0.1,
  swipeMaxMs: 500,
  scrollGain: 2500,
  magnifyHoldMs: 250,
  magnifyDeadband: 0.0015,
  extendedRatio: 1.5,
  thumbExtendedRatio: 1.8,
  stickDeadzone: 0.15,
  stickScrollPxPerSec: 1200,
  stickFlickOn: 0.8,
  stickFlickOff: 0.3,
};
