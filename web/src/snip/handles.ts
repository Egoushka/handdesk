import type { Vec3 } from "../gesture/types";
import type { Panel } from "../panel";
import { handlesOf, toWorldPoint, type Handle } from "../space/handles";

/** A snip's handles: scale corners and move like any panel, no curve, plus pin and close above the top edge. */
export function snipHandles(p: Panel, pinned: boolean): Handle[] {
  const hw = p.width / 2, hh = p.height / 2;
  const at = (x: number, y: number): Vec3 => toWorldPoint({ x, y, z: 0 }, p);
  const act: Handle[] = [{ kind: "pin", pos: at(-0.1, hh + 0.06) }, { kind: "close", pos: at(0.1, hh + 0.06) }];
  if (pinned) return act;
  return [...handlesOf(p).filter((h) => h.kind !== "curve" && !(h.kind === "move" && hw < 0.12)), ...act];
}
