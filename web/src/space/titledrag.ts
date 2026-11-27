import { extraConfig } from "../gesture/extraConfig";
import type { Vec3 } from "../gesture/types";
import type { Panel } from "../panel";

/** True when a hit (y is 0 at the top of the panel) is on the title strip. */
export const inTitleBand = (y: number, band: number = extraConfig.titleBand): boolean => y >= 0 && y <= band;

/** New panel centre when the hand moved the grabbed point from `from` to `to` (both in the panel's local plane, metres). */
export function titleDragCenter(start: Panel, from: Vec3, to: Vec3): Vec3 {
  const dx = to.x - from.x, dy = to.y - from.y;
  const c = Math.cos(start.yaw), s = Math.sin(start.yaw);
  return { x: start.center.x + dx * c, y: start.center.y + dy, z: start.center.z - dx * s };
}
