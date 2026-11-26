export type Lang = "en" | "uk";
export type Modifier = "cmd" | "ctrl" | "alt" | "shift";

export interface Key {
  /** DOM KeyboardEvent.code; the physical key sent to the Mac */
  code: string;
  /** centre in keyboard-plane metres: u right, v away from the typist */
  u: number;
  v: number;
  w: number;
  h: number;
  label: string;
  kind: "char" | "digit" | "special" | "mod" | "space" | "globe";
  mod?: Modifier;
  /** the character this key types in this layout (char keys only) */
  ch?: string;
}

export const PITCH = 0.019;
const GAP = 0.002;

const UK: Record<string, string> = {
  KeyQ: "й", KeyW: "ц", KeyE: "у", KeyR: "к", KeyT: "е", KeyY: "н", KeyU: "г", KeyI: "ш", KeyO: "щ", KeyP: "з",
  BracketLeft: "х", BracketRight: "ї", KeyA: "ф", KeyS: "і", KeyD: "в", KeyF: "а", KeyG: "п", KeyH: "р", KeyJ: "о",
  KeyK: "л", KeyL: "д", Semicolon: "ж", Quote: "є", KeyZ: "я", KeyX: "ч", KeyC: "с", KeyV: "м", KeyB: "и", KeyN: "т",
  KeyM: "ь", Comma: "б", Period: "ю", Backslash: "ґ", Slash: ".", Backquote: "'",
};

const EN_PUNCT: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  Minus: "-", Equal: "=", Backquote: "`",
};

type Spec = [code: string, w?: number];
const ROWS: Spec[][] = [
  [["Escape"], ["Backquote"], ["Digit1"], ["Digit2"], ["Digit3"], ["Digit4"], ["Digit5"], ["Digit6"], ["Digit7"], ["Digit8"], ["Digit9"], ["Digit0"], ["Minus"], ["Equal"], ["Backspace", 2]],
  [["Tab", 1.5], ["KeyQ"], ["KeyW"], ["KeyE"], ["KeyR"], ["KeyT"], ["KeyY"], ["KeyU"], ["KeyI"], ["KeyO"], ["KeyP"], ["BracketLeft"], ["BracketRight"], ["Backslash", 1.5]],
  [["Spacer", 1.75], ["KeyA"], ["KeyS"], ["KeyD"], ["KeyF"], ["KeyG"], ["KeyH"], ["KeyJ"], ["KeyK"], ["KeyL"], ["Semicolon"], ["Quote"], ["Enter", 2.25]],
  [["ShiftLeft", 2.25], ["KeyZ"], ["KeyX"], ["KeyC"], ["KeyV"], ["KeyB"], ["KeyN"], ["KeyM"], ["Comma"], ["Period"], ["Slash"], ["Globe", 1.5], ["ArrowUp"]],
  [["ControlLeft", 1.25], ["AltLeft", 1.25], ["MetaLeft", 1.5], ["Space", 6], ["MetaRight", 1.5], ["ArrowLeft"], ["ArrowDown"], ["ArrowRight"]],
];

const SPECIAL_LABEL: Record<string, string> = {
  Escape: "esc", Backspace: "⌫", Tab: "⇥", Enter: "⏎", ShiftLeft: "⇧", ControlLeft: "⌃", AltLeft: "⌥", MetaLeft: "⌘", MetaRight: "⌘",
  Space: "", Globe: "🌐", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};
const MODS: Record<string, Modifier> = { ShiftLeft: "shift", ControlLeft: "ctrl", AltLeft: "alt", MetaLeft: "cmd", MetaRight: "cmd" };

function classify(code: string, lang: Lang): Pick<Key, "kind" | "label" | "ch" | "mod"> {
  if (code === "Space") return { kind: "space", label: "" };
  if (code === "Globe") return { kind: "globe", label: lang === "en" ? "EN" : "УК" };
  const mod = MODS[code];
  if (mod) return { kind: "mod", label: SPECIAL_LABEL[code]!, mod };
  if (code.startsWith("Digit")) return { kind: "digit", label: code.slice(5), ch: code.slice(5) };
  const uk = lang === "uk" ? UK[code] : undefined;
  if (uk) return { kind: "char", label: uk, ch: uk };
  if (code.startsWith("Key")) {
    const ch = code.slice(3).toLowerCase();
    return { kind: "char", label: ch, ch };
  }
  const p = EN_PUNCT[code];
  if (p) return { kind: "special", label: p, ch: p };
  return { kind: "special", label: SPECIAL_LABEL[code] ?? code };
}

const cache = new Map<Lang, Key[]>();

/** Keys with centres in metres, keyboard centred on (0,0), row 0 farthest from the typist. */
export function buildLayout(lang: Lang): Key[] {
  const hit = cache.get(lang);
  if (hit) return hit;
  const keys: Key[] = [];
  const widths = ROWS.map((r) => r.reduce((s, [, w]) => s + (w ?? 1), 0));
  const maxW = Math.max(...widths);
  const rowCount = ROWS.length;
  ROWS.forEach((row, ri) => {
    let x = -maxW / 2;
    const v = ((rowCount - 1) / 2 - ri) * PITCH;
    for (const [code, w = 1] of row) {
      const cx = (x + w / 2) * PITCH;
      x += w;
      if (code === "Spacer") continue;
      keys.push({ code, u: cx, v, w: w * PITCH - GAP, h: PITCH - GAP, ...classify(code, lang) });
    }
  });
  cache.set(lang, keys);
  return keys;
}

export const letterKeys = (lang: Lang): Key[] => buildLayout(lang).filter((k) => k.kind === "char" && /\p{L}/u.test(k.ch ?? ""));
