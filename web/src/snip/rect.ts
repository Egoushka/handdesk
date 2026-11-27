/** A region of a panel in uv: 0..1, top-left origin, x0 < x1 and y0 < y1. */
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export const MIN_SNIP = 0.02;
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The rectangle spanned by two corner points, clamped to the panel. */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x0: clamp01(Math.min(a.x, b.x)), y0: clamp01(Math.min(a.y, b.y)), x1: clamp01(Math.max(a.x, b.x)), y1: clamp01(Math.max(a.y, b.y)) };
}

/** Big enough to cut out; a tiny drag is a cancelled snip. */
export const rectValid = (r: Rect): boolean => r.x1 - r.x0 >= MIN_SNIP && r.y1 - r.y0 >= MIN_SNIP;

/** A point on the snip (0..1) as a point on the source panel: this is how a tap on a snip reaches the right Mac coordinates. */
export const toSource = (r: Rect, x: number, y: number): { x: number; y: number } => ({ x: r.x0 + x * (r.x1 - r.x0), y: r.y0 + y * (r.y1 - r.y0) });
export const fromSource = (r: Rect, x: number, y: number): { x: number; y: number } => ({ x: (x - r.x0) / (r.x1 - r.x0), y: (y - r.y0) / (r.y1 - r.y0) });

/** Texture coordinates of the four corners (bottom-left, bottom-right, top-left, top-right); canvas textures have v = 0 at the bottom. */
export const cropUv = (r: Rect): number[] => [r.x0, 1 - r.y1, r.x1, 1 - r.y1, r.x0, 1 - r.y0, r.x1, 1 - r.y0];

/** Starting size of a snip: the region at its real size, but never narrower than `minWidth` or wider than `maxWidth`. */
export function snipSize(r: Rect, source: { width: number; height: number }, minWidth = 0.3, maxWidth = 1.2): { width: number; height: number } {
  const w = (r.x1 - r.x0) * source.width;
  const h = (r.y1 - r.y0) * source.height;
  const s = Math.min(maxWidth / w, Math.max(1, minWidth / w));
  return { width: w * s, height: h * s };
}
