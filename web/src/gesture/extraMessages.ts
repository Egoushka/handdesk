import type { ClientMessage } from "../protocol";
import type { ExtraEvent } from "./extra";

const tap = (code: string, modifiers?: string[]): ClientMessage[] => [
  { type: "key", code, down: true, modifiers },
  { type: "key", code, down: false, modifiers },
];

/** Gestures that are one Mac shortcut. Fist drag, spread and title move need the scene, so the page handles those. */
export function extraToMessages(ev: ExtraEvent): ClientMessage[] {
  switch (ev.type) {
    case "back": return tap("BracketLeft", ["cmd"]);
    case "forward": return tap("BracketRight", ["cmd"]);
    case "mission-control": return [{ type: "swipe", direction: "up" }];
    case "hide-window": return tap("KeyH", ["cmd"]);
    case "screenshot": return tap("Digit3", ["cmd", "shift"]);
    case "enter": return tap("Enter");
    default: return [];
  }
}
