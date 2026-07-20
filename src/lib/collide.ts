import { NODE_WIDTH, NODE_HEIGHT } from "./layout";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN = 12;

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Minimal offset (axis of least penetration) to move `me` out of `hit`. */
function pushDelta(me: Rect, hit: Rect): { dx: number; dy: number } {
  const pushRight = hit.x + hit.w + MARGIN - me.x;
  const pushLeft = me.x + me.w + MARGIN - hit.x;
  const pushDown = hit.y + hit.h + MARGIN - me.y;
  const pushUp = me.y + me.h + MARGIN - hit.y;
  const min = Math.min(pushRight, pushLeft, pushDown, pushUp);
  if (min === pushRight) return { dx: pushRight, dy: 0 };
  if (min === pushLeft) return { dx: -pushLeft, dy: 0 };
  if (min === pushDown) return { dx: 0, dy: pushDown };
  return { dx: 0, dy: -pushUp };
}

/**
 * The plugin's only collision helper: the card that was just DROPPED slides
 * minimally off other cards so nothing stacks exactly on top of each other.
 * Only the dropped card itself moves — surrounding cards are untouched
 * (no solver, no "magnetic" behavior).
 */
export function nudgeCard(
  dropped: { x: number; y: number },
  others: { x: number; y: number }[],
): { x: number; y: number } {
  const pos = { x: dropped.x, y: dropped.y };
  for (let iter = 0; iter < 8; iter++) {
    const me: Rect = { x: pos.x, y: pos.y, w: NODE_WIDTH, h: NODE_HEIGHT };
    const hit = others.find((o) => overlaps(me, { x: o.x, y: o.y, w: NODE_WIDTH, h: NODE_HEIGHT }));
    if (!hit) break;
    const d = pushDelta(me, { x: hit.x, y: hit.y, w: NODE_WIDTH, h: NODE_HEIGHT });
    pos.x += d.dx;
    pos.y += d.dy;
  }
  return { x: Math.round(pos.x), y: Math.round(pos.y) };
}
