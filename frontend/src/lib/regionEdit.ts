/**
 * The math behind dragging and resizing a traced region. Kept free of React
 * and the DOM so it's just numbers in, numbers out — TracerCanvas handles
 * the pointer events and hands the results here.
 *
 * All coordinates are pixels on the original sheet (the SVG's own coordinate
 * space), and every result is clamped to the sheet, so what you see while
 * dragging is exactly what gets saved.
 */

import type { Point } from "../types/annotation";

export type RectHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export type EditMode =
  | { kind: "move" }
  | { kind: "rect-handle"; handle: RectHandle }
  | { kind: "vertex"; index: number };

export interface Size {
  w: number;
  h: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Smallest a box may be shrunk to, as a fraction of the sheet — the same 1%
// floor the Box tool uses when drawing, so a region can't be resized into a
// sliver that couldn't have been drawn in the first place.
const MIN_FRACTION = 0.01;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function boundsOf(points: Point[]): Bounds {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function rectPoints({ x0, y0, x1, y1 }: Bounds): Point[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** True for regions made by the Box tool, AI suggestions, or a merge. Their
 * 8 bounding-box handles are all they need; other polygons (from the Pen
 * tool) additionally get a handle per vertex for reshaping. */
export function isAxisAlignedRect(points: Point[]): boolean {
  if (points.length !== 4) return false;
  const xs = new Set(points.map((p) => p[0]));
  const ys = new Set(points.map((p) => p[1]));
  const corners = new Set(points.map((p) => `${p[0]},${p[1]}`));
  return xs.size === 2 && ys.size === 2 && corners.size === 4;
}

export function handlePositions({ x0, y0, x1, y1 }: Bounds): Record<RectHandle, Point> {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  return {
    nw: [x0, y0],
    n: [mx, y0],
    ne: [x1, y0],
    e: [x1, my],
    se: [x1, y1],
    s: [mx, y1],
    sw: [x0, y1],
    w: [x0, my],
  };
}

export const HANDLE_CURSORS: Record<RectHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/**
 * The region's points after dragging from `start` to `current`, given the
 * points it had when the drag began (`orig`).
 */
export function applyEdit(mode: EditMode, orig: Point[], start: Point, current: Point, size: Size): Point[] {
  const dx = current[0] - start[0];
  const dy = current[1] - start[1];

  if (mode.kind === "move") {
    const b = boundsOf(orig);
    // Clamp the shift (not each point) so the shape keeps its exact size and
    // simply stops at the sheet's edge.
    const shiftX = clamp(dx, -b.x0, size.w - b.x1);
    const shiftY = clamp(dy, -b.y0, size.h - b.y1);
    return orig.map(([x, y]) => [x + shiftX, y + shiftY] as Point);
  }

  if (mode.kind === "vertex") {
    return orig.map((p, i) =>
      i === mode.index ? ([clamp(p[0] + dx, 0, size.w), clamp(p[1] + dy, 0, size.h)] as Point) : p,
    );
  }

  // rect-handle: move only the edge(s) this handle owns; the opposite edge
  // stays put, and an edge can't be dragged past it (no flipping).
  const b = boundsOf(orig);
  const minW = Math.max(1, size.w * MIN_FRACTION);
  const minH = Math.max(1, size.h * MIN_FRACTION);
  const next = { ...b };
  if (mode.handle.includes("w")) next.x0 = clamp(b.x0 + dx, 0, b.x1 - minW);
  if (mode.handle.includes("e")) next.x1 = clamp(b.x1 + dx, b.x0 + minW, size.w);
  if (mode.handle.includes("n")) next.y0 = clamp(b.y0 + dy, 0, b.y1 - minH);
  if (mode.handle.includes("s")) next.y1 = clamp(b.y1 + dy, b.y0 + minH, size.h);
  return scaleInto(orig, b, next);
}

/** Maps points from one bounding box onto another (so a polygon scales as a
 * whole when its box is resized). For a plain rectangle this just moves its
 * corners to the new box's corners. Results are whole pixels, like every
 * other coordinate here. */
function scaleInto(points: Point[], from: Bounds, to: Bounds): Point[] {
  const fw = from.x1 - from.x0;
  const fh = from.y1 - from.y0;
  return points.map(([x, y]) => {
    const tx = fw === 0 ? 0 : (x - from.x0) / fw;
    const ty = fh === 0 ? 0 : (y - from.y0) / fh;
    return [Math.round(to.x0 + tx * (to.x1 - to.x0)), Math.round(to.y0 + ty * (to.y1 - to.y0))] as Point;
  });
}

export function samePoints(a: Point[], b: Point[]): boolean {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}
