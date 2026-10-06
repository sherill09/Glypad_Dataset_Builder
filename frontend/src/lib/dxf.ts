/**
 * A small, dependency-free ASCII DXF parser and canvas renderer.
 *
 * This is a best-effort preview, not a full CAD reader: it only
 * understands LINE, CIRCLE, ARC, (LW)POLYLINE and TEXT/MTEXT entities.
 * Splines, hatches, dimensions-as-blocks and external block references
 * aren't drawn, and arc sweep direction is approximate. That's enough to
 * see the shape of most simple 2D drawings, which is the point — it's a
 * dataset-building tool, not a DXF viewer for production drafting work.
 */

export type Point = [number, number];

interface DxfLine {
  t: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface DxfCircle {
  t: "circle";
  cx: number;
  cy: number;
  r: number;
}
interface DxfArc {
  t: "arc";
  cx: number;
  cy: number;
  r: number;
  a1: number;
  a2: number;
}
interface DxfPoly {
  t: "poly";
  pts: Point[];
  closed: boolean;
}
interface DxfText {
  t: "text";
  x: number;
  y: number;
  h: number;
  s: string;
}

export type DxfPrimitive = DxfLine | DxfCircle | DxfArc | DxfPoly | DxfText;

type RawEntity =
  | DxfPrimitive
  | { t: "polyline_start"; closed: boolean }
  | { t: "vertex"; x: number; y: number }
  | { t: "seqend" };

function num(values: string[] | undefined): number {
  if (!values || values.length === 0) return NaN;
  return parseFloat(values[values.length - 1]);
}

export function parseDXFToPrimitives(text: string): DxfPrimitive[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    pairs.push([code, lines[i + 1]]);
  }

  // Isolate the ENTITIES section.
  let start = -1;
  let end = -1;
  for (let j = 0; j < pairs.length; j++) {
    if (start === -1 && pairs[j][0] === 2 && pairs[j][1].trim().toUpperCase() === "ENTITIES") {
      start = j + 1;
      continue;
    }
    if (start !== -1 && pairs[j][0] === 0 && pairs[j][1].trim().toUpperCase() === "ENDSEC") {
      end = j;
      break;
    }
  }
  if (start === -1) return [];
  const epairs = pairs.slice(start, end === -1 ? pairs.length : end);

  const raw: RawEntity[] = [];
  let k = 0;
  while (k < epairs.length) {
    if (epairs[k][0] === 0) {
      const type = epairs[k][1].trim().toUpperCase();
      k++;
      const fields: Record<number, string[]> = {};
      while (k < epairs.length && epairs[k][0] !== 0) {
        const [code2, val] = epairs[k];
        (fields[code2] = fields[code2] || []).push(val);
        k++;
      }
      if (type === "LINE") {
        raw.push({ t: "line", x1: num(fields[10]), y1: num(fields[20]), x2: num(fields[11]), y2: num(fields[21]) });
      } else if (type === "CIRCLE") {
        raw.push({ t: "circle", cx: num(fields[10]), cy: num(fields[20]), r: num(fields[40]) });
      } else if (type === "ARC") {
        raw.push({
          t: "arc",
          cx: num(fields[10]),
          cy: num(fields[20]),
          r: num(fields[40]),
          a1: num(fields[50]),
          a2: num(fields[51]),
        });
      } else if (type === "LWPOLYLINE") {
        const xs = fields[10] || [];
        const ys = fields[20] || [];
        const pts: Point[] = [];
        for (let m = 0; m < Math.min(xs.length, ys.length); m++) {
          pts.push([parseFloat(xs[m]), parseFloat(ys[m])]);
        }
        const closed70 = fields[70] ? parseInt(fields[70][fields[70].length - 1], 10) || 0 : 0;
        if (pts.length > 1) raw.push({ t: "poly", pts, closed: !!(closed70 & 1) });
      } else if (type === "POLYLINE") {
        const closedP = fields[70] ? parseInt(fields[70][fields[70].length - 1], 10) || 0 : 0;
        raw.push({ t: "polyline_start", closed: !!(closedP & 1) });
      } else if (type === "VERTEX") {
        raw.push({ t: "vertex", x: num(fields[10]), y: num(fields[20]) });
      } else if (type === "SEQEND") {
        raw.push({ t: "seqend" });
      } else if (type === "TEXT" || type === "MTEXT") {
        raw.push({ t: "text", x: num(fields[10]), y: num(fields[20]), h: num(fields[40]) || 10, s: (fields[1] || [""])[0] });
      }
    } else {
      k++;
    }
  }

  // Stitch POLYLINE + VERTEX* + SEQEND sequences into single "poly" primitives.
  const out: DxfPrimitive[] = [];
  for (let n = 0; n < raw.length; n++) {
    const item = raw[n];
    if (item.t === "polyline_start") {
      const polyClosed = item.closed;
      const verts: Point[] = [];
      let n2 = n + 1;
      while (n2 < raw.length && raw[n2].t === "vertex") {
        const v = raw[n2] as { t: "vertex"; x: number; y: number };
        verts.push([v.x, v.y]);
        n2++;
      }
      n = n2 < raw.length && raw[n2].t === "seqend" ? n2 : n2 - 1;
      if (verts.length > 1) out.push({ t: "poly", pts: verts, closed: polyClosed });
    } else if (item.t !== "vertex" && item.t !== "seqend") {
      out.push(item as DxfPrimitive);
    }
  }
  return out.filter(isFinitePrimitive);
}

function isFinitePrimitive(p: DxfPrimitive): boolean {
  if (p.t === "line") return isFinite(p.x1) && isFinite(p.y1) && isFinite(p.x2) && isFinite(p.y2);
  if (p.t === "circle") return isFinite(p.cx) && isFinite(p.cy) && isFinite(p.r) && p.r > 0;
  if (p.t === "arc") {
    return isFinite(p.cx) && isFinite(p.cy) && isFinite(p.r) && p.r > 0 && isFinite(p.a1) && isFinite(p.a2);
  }
  if (p.t === "poly") return p.pts.length > 1 && p.pts.every(([x, y]) => isFinite(x) && isFinite(y));
  if (p.t === "text") return isFinite(p.x) && isFinite(p.y);
  return false;
}

function boundingBox(prims: DxfPrimitive[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const update = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  prims.forEach((p) => {
    if (p.t === "line") {
      update(p.x1, p.y1);
      update(p.x2, p.y2);
    } else if (p.t === "circle") {
      update(p.cx - p.r, p.cy - p.r);
      update(p.cx + p.r, p.cy + p.r);
    } else if (p.t === "arc") {
      update(p.cx - p.r, p.cy - p.r);
      update(p.cx + p.r, p.cy + p.r);
    } else if (p.t === "poly") {
      p.pts.forEach(([x, y]) => update(x, y));
    } else if (p.t === "text") {
      update(p.x, p.y);
      update(p.x + p.h * p.s.length * 0.6, p.y + p.h);
    }
  });
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Draws the parsed entities onto `canvas` (sizing it to fit) and returns
 * the canvas's final pixel size, or null if there was nothing drawable.
 */
export function renderDxfOntoCanvas(canvas: HTMLCanvasElement, prims: DxfPrimitive[]): { w: number; h: number } | null {
  const box = boundingBox(prims);
  if (!box) return null;

  let w0 = Math.max(box.maxX - box.minX, 1);
  let h0 = Math.max(box.maxY - box.minY, 1);
  const pad = Math.max(w0, h0) * 0.04;
  w0 += pad * 2;
  h0 += pad * 2;
  const scale = 1500 / w0;
  const W = Math.max(200, Math.round(w0 * scale));
  const H = Math.max(200, Math.round(h0 * scale));

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#1b2430";
  ctx.fillStyle = "#1b2430";
  ctx.lineWidth = 1.2;

  const tx = (x: number) => (x - box.minX + pad) * scale;
  const ty = (y: number) => H - (y - box.minY + pad) * scale; // DXF is Y-up, canvas is Y-down

  prims.forEach((p) => {
    ctx.beginPath();
    if (p.t === "line") {
      ctx.moveTo(tx(p.x1), ty(p.y1));
      ctx.lineTo(tx(p.x2), ty(p.y2));
      ctx.stroke();
    } else if (p.t === "circle") {
      ctx.arc(tx(p.cx), ty(p.cy), Math.max(p.r * scale, 0.5), 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.t === "arc") {
      // Best-effort: DXF angles are CCW degrees; canvas arcs sweep CW in a
      // Y-flipped space, so the sweep direction is approximate for some arcs.
      const a1 = (-p.a1 * Math.PI) / 180;
      const a2 = (-p.a2 * Math.PI) / 180;
      ctx.arc(tx(p.cx), ty(p.cy), Math.max(p.r * scale, 0.5), a1, a2, true);
      ctx.stroke();
    } else if (p.t === "poly") {
      p.pts.forEach(([x, y], idx) => {
        if (idx === 0) ctx.moveTo(tx(x), ty(y));
        else ctx.lineTo(tx(x), ty(y));
      });
      if (p.closed) ctx.closePath();
      ctx.stroke();
    } else if (p.t === "text") {
      const fs = Math.max(8, p.h * scale);
      ctx.font = `${fs}px sans-serif`;
      ctx.fillText(p.s, tx(p.x), ty(p.y));
    }
  });

  return { w: W, h: H };
}
