import type { Panel } from "../panel";
import type { Head } from "./layout";
import { SPAWN_DISTANCE, SPAWN_WIDTH } from "./surface";

/** Window panels spawn this far in front of the head (m): 15 cm nearer than the display row so they do not overlap it, still inside 1.2..1.6 m. */
export const WINDOW_DISTANCE = SPAWN_DISTANCE - 0.15;
/** Each further window panel steps this far to the right (m) so they do not hide each other. */
export const WINDOW_STEP = 0.18;

/** Width in metres of a panel for a Mac window `pointsWide` points across: bigger windows get bigger panels, within 0.9..1.3 m. */
export const windowPanelWidth = (pointsWide: number): number => Math.min(SPAWN_WIDTH, Math.max(0.9, pointsWide / 900));

/** A panel for a Mac window, in front of the head. `index` is how many window panels exist already. */
export function windowPanel(windowId: number, size: { width: number; height: number }, head: Head, index: number): Panel {
  const fx = Math.sin(head.yaw), fz = -Math.cos(head.yaw), rx = Math.cos(head.yaw), rz = Math.sin(head.yaw);
  const width = windowPanelWidth(size.width);
  const off = (index % 4) * WINDOW_STEP - 0.2;
  const d = WINDOW_DISTANCE - (index % 4) * 0.04;
  return {
    display: -2,
    windowId,
    center: { x: head.position.x + fx * d + rx * off, y: head.position.y, z: head.position.z + fz * d + rz * off },
    yaw: -head.yaw,
    width,
    height: width * (size.height / size.width),
    curve: 0.2,
  };
}
