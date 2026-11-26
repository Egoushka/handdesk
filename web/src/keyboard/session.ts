import { hitTest, snap, suggest } from "./autocorrect";
import { buildLayout, type Key, type Lang, type Modifier } from "./layouts";

export type KeyAction =
  | { kind: "key"; code: string; modifiers: Modifier[] }
  | { kind: "text"; text: string }
  | { kind: "layout"; lang: Lang };

const DOUBLE_TAP_MS = 400;
const ORDER: Modifier[] = ["cmd", "ctrl", "alt", "shift"];
/** Ukrainian punctuation keys: Shift gives a different character, not an upper-case one */
const UK_SHIFT: Record<string, string> = { Slash: ",", Backquote: "ʼ" };

interface ModState { armed: boolean; locked: boolean; lastTap: number }

/** Typing state: layout, sticky modifiers, the word being typed. Pure; the page feeds it key presses. */
export class TypingSession {
  lang: Lang = "en";
  prefix = "";
  private mods: Record<Modifier, ModState> = {
    cmd: { armed: false, locked: false, lastTap: -Infinity },
    ctrl: { armed: false, locked: false, lastTap: -Infinity },
    alt: { armed: false, locked: false, lastTap: -Infinity },
    shift: { armed: false, locked: false, lastTap: -Infinity },
  };

  get keys(): Key[] { return buildLayout(this.lang); }

  /** half-size of the key block plus a margin; a thumb must land inside it to type Space */
  private get extent(): { u: number; v: number } {
    const ks = this.keys;
    return { u: Math.max(...ks.map((k) => Math.abs(k.u) + k.w / 2)) + 0.03, v: Math.max(...ks.map((k) => Math.abs(k.v) + k.h / 2)) + 0.05 };
  }

  modifierState(m: Modifier): "off" | "armed" | "locked" {
    const s = this.mods[m];
    return s.locked ? "locked" : s.armed ? "armed" : "off";
  }

  suggestions(): string[] { return suggest(this.lang, this.prefix); }

  /** A press at keyboard-plane (u, v). Thumbs pass isThumb and always type Space. */
  pressAt(u: number, v: number, time: number, isThumb = false): { actions: KeyAction[]; key: Key | undefined } {
    const keys = this.keys;
    const over = Math.abs(u) <= this.extent.u && Math.abs(v) <= this.extent.v;
    if (isThumb && !over) return { actions: [], key: undefined };
    const nearest = isThumb ? keys.find((k) => k.code === "Space") : hitTest(keys, u, v);
    if (!nearest) return { actions: [], key: undefined };
    const key = isThumb ? nearest : snap(this.lang, this.prefix, u, v, nearest).key;
    return { actions: this.tap(key, time), key };
  }

  tap(key: Key, time: number): KeyAction[] {
    if (key.kind === "globe") {
      this.lang = this.lang === "en" ? "uk" : "en";
      this.prefix = "";
      return [{ kind: "layout", lang: this.lang }];
    }
    if (key.kind === "mod" && key.mod) {
      const s = this.mods[key.mod];
      if (s.locked) { s.locked = false; s.armed = false; }
      else if (s.armed && time - s.lastTap <= DOUBLE_TAP_MS) { s.locked = true; }
      else s.armed = !s.armed;
      s.lastTap = time;
      return [];
    }

    const modifiers = ORDER.filter((m) => this.mods[m].armed || this.mods[m].locked);
    const shortcut = modifiers.some((m) => m === "cmd" || m === "ctrl" || m === "alt");
    for (const m of ORDER) if (!this.mods[m].locked) this.mods[m].armed = false;

    const word = key.kind === "char" && key.ch ? key.ch : undefined;
    if (key.kind === "char" && this.lang === "uk" && !shortcut && word) {
      const shifted = modifiers.includes("shift");
      const text = shifted ? (UK_SHIFT[key.code] ?? word.toUpperCase()) : word;
      if (/\p{L}/u.test(word)) this.prefix += word;
      else this.prefix = "";
      return [{ kind: "text", text }];
    }
    if (key.kind === "char" && word && !shortcut) this.prefix += word;
    else if (key.code === "Backspace") this.prefix = this.prefix.slice(0, -1);
    else this.prefix = "";
    return [{ kind: "key", code: key.code, modifiers }];
  }

  /** Accept suggestion i: types the rest of the word and a space. */
  accept(i: number): KeyAction[] {
    const w = this.suggestions()[i];
    if (!w) return [];
    const rest = w.slice(this.prefix.length) + " ";
    this.prefix = "";
    return [{ kind: "text", text: rest }];
  }
}
