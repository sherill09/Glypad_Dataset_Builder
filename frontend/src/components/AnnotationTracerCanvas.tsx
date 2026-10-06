import { useEffect, useRef, useState } from "react";

import {
  HANDLE_CURSORS,
  applyEdit,
  boundsOf,
  handlePositions,
  isAxisAlignedRect,
  samePoints,
  type EditMode,
  type RectHandle,
} from "../lib/regionEdit";
import { KIND_LABELS, type Entity, type Point, type Region } from "../types/annotation";
import { DxfBackground } from "./DxfBackground";
import { PdfBackground } from "./PdfBackground";

export type Tool = "pen" | "box" | "select" | "eraser" | "pan";

const REGION_COLOR = "#2f5fb3";
const ENTITY_COLOR = "#c0432f";

const PEN_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M0 0 L4 1.5 L8.5 6 L6 8.5 L1.5 4 Z' fill='%23000000' stroke='%23ffffff' stroke-width='0.6'/%3E%3Cline x1='0' y1='0' x2='3.5' y2='3.5' stroke='%23ffffff' stroke-width='0.6'/%3E%3Ccircle cx='3.5' cy='3.5' r='0.5' fill='%23ffffff'/%3E%3C/svg%3E") 0 0, crosshair`;

const ERASER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14' fill='none'%3E%3Cpath d='M3 12 L0.5 9.5 C0.2 9.2 0.2 8.7 0.5 8.4 L7 1.9 C7.3 1.6 7.8 1.6 8.1 1.9 L12.1 5.9 C12.4 6.2 12.4 6.7 12.1 7 L7.5 11.6 L3 12 Z' fill='%23ffffff' stroke='%23000000' stroke-width='0.8'/%3E%3Cpath d='M3 12 L0.5 9.5 L5 5 L8 8 Z' fill='%23ef4444' stroke='%23000000' stroke-width='0.8'/%3E%3Cline x1='3' y1='12' x2='13' y2='12' stroke='%23000000' stroke-width='1'/%3E%3C/svg%3E") 3 11, pointer`;

function svgPointFromEvent(svg: SVGSVGElement, evt: { clientX: number; clientY: number }): Point {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return [0, 0];
  const loc = pt.matrixTransform(ctm.inverse());
  return [Math.round(loc.x), Math.round(loc.y)];
}

type Drawing = { kind: "pen"; points: Point[]; current?: Point } | { kind: "box"; start: Point; cur: Point } | null;

// A selected shape being dragged — a region OR an entity, tracked uniformly
// since the drag math (regionEdit.ts) only cares about a Point[], not what
// kind of row it came from.
interface EditGesture {
  shapeKind: "region" | "entity";
  shapeId: string;
  mode: EditMode;
  start: Point;
  orig: Point[];
}

const CLICK_AFTER_EDIT_MS = 300;
const IMG_FORMATS = new Set(["svg", "png", "jpg", "jpeg"]);

interface Props {
  imageUrl: string;
  altText: string;
  format: string;
  tool: Tool;
  /** The version is approved — viewing only, no drawing/moving/resizing.
   * Selecting a shape (to inspect it) still works. */
  readOnly?: boolean;
  zoomPct: number;
  regions: Region[];
  entities: Entity[];
  selectedRegionIds: string[];
  selectedEntityId: string | null;
  /** Set while the person is drawing a new entity for this region (the
   * next box-drag creates an entity instead of a region) — see the
   * "+ Add entity" action in AnnotationVersionPage. */
  entityDrawRegionId: string | null;
  /** False on the Entities tab (PHASE2_IMPLEMENTATION_PLAN.md §2.3 step
   * 10): regions render faint/dashed and purely as a map of where things
   * are -- no drag/resize/multi-select, and a click arms that region for
   * entity drawing (via onArmRegionForEntityDrawing) instead of selecting
   * it for editing. Entities are never affected by this -- they stay
   * fully interactive regardless. Defaults to true (the Regions tab's
   * normal, fully-editable behavior). */
  regionsInteractive?: boolean;
  /** Only used when regionsInteractive is false -- clicking a region then
   * means "annotate entities inside this one," not "select to edit." */
  onArmRegionForEntityDrawing?: (id: string) => void;
  viewportRef: React.RefObject<HTMLDivElement>;
  onNaturalSize: (size: { w: number; h: number }) => void;
  onImageError: () => void;
  onInfo?: (message: string) => void;
  onCreateRegion: (points: Point[]) => void;
  onCreateEntity: (regionId: string, bbox: Point[]) => void;
  onSelectRegionOnly: (id: string | null) => void;
  onToggleSelectRegion: (id: string) => void;
  onSelectEntity: (id: string | null) => void;
  onUpdateRegionPoints: (id: string, points: Point[]) => Promise<void>;
  onUpdateEntityBbox: (id: string, bbox: Point[]) => Promise<void>;
  onDeleteRegions: (ids: string[]) => void;
  onDeleteEntity: (id: string) => void;
}

export function AnnotationTracerCanvas({
  imageUrl,
  altText,
  format,
  tool,
  readOnly = false,
  zoomPct,
  regions,
  entities,
  selectedRegionIds,
  selectedEntityId,
  entityDrawRegionId,
  regionsInteractive = true,
  onArmRegionForEntityDrawing,
  viewportRef,
  onNaturalSize,
  onImageError,
  onInfo,
  onCreateRegion,
  onCreateEntity,
  onSelectRegionOnly,
  onToggleSelectRegion,
  onSelectEntity,
  onUpdateRegionPoints,
  onUpdateEntityBbox,
  onDeleteRegions,
  onDeleteEntity,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [drawing, setDrawing] = useState<Drawing>(null);
  const panState = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  const [preview, setPreview] = useState<{ shapeKind: "region" | "entity"; id: string; points: Point[] } | null>(null);
  const gesture = useRef<EditGesture | null>(null);
  const latestPoints = useRef<Point[] | null>(null);
  const lastEditEnd = useRef(0);
  const saving = useRef(false);
  const stopListening = useRef<(() => void) | null>(null);

  function handleBackgroundReady(size: { w: number; h: number }) {
    setNaturalSize(size);
    onNaturalSize(size);
  }

  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    handleBackgroundReady({ w: img.naturalWidth || 1000, h: img.naturalHeight || 1000 });
  }

  function finishPen() {
    if (drawing?.kind === "pen" && drawing.points.length >= 3) {
      if (entityDrawRegionId) onCreateEntity(entityDrawRegionId, drawing.points);
      else onCreateRegion(drawing.points);
    }
    setDrawing(null);
  }

  function handleEraseRegionSegment(regionId: string, segmentIndex: number, currentPoints: Point[]) {
    if (readOnly) return;
    // An edge between currentPoints[segmentIndex] and currentPoints[(segmentIndex + 1) % currentPoints.length] is removed.
    // Break the loop and form an open polyline starting at (segmentIndex + 1) and wrapping around to segmentIndex.
    const n = currentPoints.length;
    const openPoints: Point[] = [];
    for (let step = 1; step <= n; step++) {
      const idx = (segmentIndex + step) % n;
      openPoints.push(currentPoints[idx]);
    }
    // Delete the region from database/state since it is no longer a closed region
    onDeleteRegions([regionId]);
    // Transition the remaining open chain into active pen drawing/draft
    setDrawing({ kind: "pen", points: openPoints });
  }

  function handleEraseEntitySegment(entityId: string, segmentIndex: number, currentBbox: Point[]) {
    if (readOnly) return;
    const n = currentBbox.length;
    const openPoints: Point[] = [];
    for (let step = 1; step <= n; step++) {
      const idx = (segmentIndex + step) % n;
      openPoints.push(currentBbox[idx]);
    }
    onDeleteEntity(entityId);
    setDrawing({ kind: "pen", points: openPoints });
  }

  function handleEraseDraftSegment(segmentIndex: number) {
    if (readOnly || !drawing || drawing.kind !== "pen") return;
    const pts = drawing.points;
    if (pts.length <= 2) {
      setDrawing(null);
      return;
    }
    if (segmentIndex === 0) {
      setDrawing({ kind: "pen", points: pts.slice(1) });
    } else if (segmentIndex === pts.length - 2) {
      setDrawing({ kind: "pen", points: pts.slice(0, -1) });
    } else {
      const partA = pts.slice(0, segmentIndex + 1);
      const partB = pts.slice(segmentIndex + 1);
      const nextPts = partA.length >= partB.length ? partA : partB;
      setDrawing(nextPts.length >= 2 ? { kind: "pen", points: nextPts } : null);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter" && drawing?.kind === "pen" && drawing.points.length >= 3) finishPen();
      if (e.key === "Escape" && drawing) setDrawing(null);
      if (e.key === "Escape" && gesture.current) void endEdit(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing, entityDrawRegionId]);

  function pointsForRegion(region: Region): Point[] {
    return preview?.shapeKind === "region" && preview.id === region.id ? preview.points : region.points;
  }
  function bboxForEntity(entity: Entity): Point[] {
    return preview?.shapeKind === "entity" && preview.id === entity.id ? preview.points : entity.bbox;
  }

  function beginEdit(e: React.PointerEvent, shapeKind: "region" | "entity", id: string, orig: Point[], mode: EditMode) {
    if (!svgRef.current || !naturalSize) return;
    e.stopPropagation();
    e.preventDefault();
    if (saving.current) return;

    const size = naturalSize;
    gesture.current = { shapeKind, shapeId: id, mode, start: svgPointFromEvent(svgRef.current, e), orig: orig.map(([x, y]) => [x, y] as Point) };
    latestPoints.current = null;

    const onMove = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g || !svgRef.current) return;
      const next = applyEdit(g.mode, g.orig, g.start, svgPointFromEvent(svgRef.current, ev), size);
      latestPoints.current = next;
      setPreview({ shapeKind: g.shapeKind, id: g.shapeId, points: next });
    };
    const onUp = () => void endEdit(true);
    const onCancel = () => void endEdit(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    stopListening.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }

  useEffect(() => () => stopListening.current?.(), []);

  async function endEdit(commit: boolean) {
    stopListening.current?.();
    stopListening.current = null;
    const g = gesture.current;
    const finalPoints = latestPoints.current;
    gesture.current = null;
    latestPoints.current = null;
    lastEditEnd.current = performance.now();
    if (!g) return;

    if (!commit || !finalPoints || samePoints(finalPoints, g.orig)) {
      setPreview(null);
      return;
    }
    saving.current = true;
    try {
      if (g.shapeKind === "region") await onUpdateRegionPoints(g.shapeId, finalPoints);
      else await onUpdateEntityBbox(g.shapeId, finalPoints);
    } finally {
      saving.current = false;
      setPreview(null);
    }
  }

  useEffect(() => {
    if (tool !== "pen") {
      setDrawing((prev) => (prev?.kind === "pen" ? null : prev));
    }
  }, [tool]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && drawing?.kind === "pen") {
        setDrawing(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawing]);

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (readOnly) return;
    if (performance.now() - lastEditEnd.current < CLICK_AFTER_EDIT_MS) return;
    if (tool !== "pen" || !svgRef.current || !naturalSize) return;

    // Requirement:
    // "the pen should draw the line only with the shift and mouse click means when the user wants to draw something with the pen, they should hold the shift then move wherever they want and the line continues. with each click of the mouse, a point is formed and when closed loop is formed, that is the region as usual."
    if (!e.shiftKey) {
      if (drawing?.kind === "pen" && drawing.points.length > 0) {
        onInfo?.("Hold Shift and click to add the next point or close the region.");
      } else {
        onInfo?.("Hold Shift and click to place your first point with the Pen.");
      }
      return;
    }

    const p = svgPointFromEvent(svgRef.current, e);

    if (drawing?.kind === "pen" && drawing.points.length > 0) {
      const [fx, fy] = drawing.points[0];
      const closeRadius = 10 * screenPx;
      if (drawing.points.length >= 3 && Math.hypot(p[0] - fx, p[1] - fy) <= closeRadius) {
        finishPen();
        return;
      }
      setDrawing({ kind: "pen", points: [...drawing.points, p], current: p });
    } else {
      setDrawing({ kind: "pen", points: [p], current: p });
    }
  }

  function handleDoubleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (readOnly || tool !== "pen" || !svgRef.current) return;
    if (e.shiftKey && drawing?.kind === "pen" && drawing.points.length >= 3) {
      finishPen();
    }
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    if (e.button === 1 || (tool === "pan" && viewportRef.current)) {
      if (viewportRef.current) {
        panState.current = { x: e.clientX, y: e.clientY, scrollLeft: viewportRef.current.scrollLeft, scrollTop: viewportRef.current.scrollTop };
        svgRef.current.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool === "box" && !readOnly) {
      const p = svgPointFromEvent(svgRef.current, e);
      setDrawing({ kind: "box", start: p, cur: p });
      svgRef.current.setPointerCapture(e.pointerId);
    } else if (tool === "select") {
      onSelectRegionOnly(null);
      onSelectEntity(null);
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!svgRef.current) return;
    const p = svgPointFromEvent(svgRef.current, e);
    if (tool === "pen" && drawing?.kind === "pen" && drawing.points.length > 0) {
      setDrawing((prev) => (prev?.kind === "pen" ? { ...prev, current: p } : prev));
    } else if (tool === "box" && drawing?.kind === "box") {
      setDrawing({ kind: "box", start: drawing.start, cur: p });
    } else if (tool === "pan" && panState.current && viewportRef.current) {
      viewportRef.current.scrollLeft = panState.current.scrollLeft - (e.clientX - panState.current.x);
      viewportRef.current.scrollTop = panState.current.scrollTop - (e.clientY - panState.current.y);
    }
  }

  function handlePointerUp() {
    if (tool === "box" && drawing?.kind === "box" && naturalSize) {
      const [sx, sy] = drawing.start;
      const [cx, cy] = drawing.cur;
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);
      if (w > naturalSize.w * 0.01 && h > naturalSize.h * 0.01) {
        const x0 = Math.min(sx, cx);
        const y0 = Math.min(sy, cy);
        const box: Point[] = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
        if (entityDrawRegionId) onCreateEntity(entityDrawRegionId, box);
        else onCreateRegion(box);
      }
      setDrawing(null);
    }
    panState.current = null;
  }

  const stageWidth = naturalSize ? (naturalSize.w * zoomPct) / 100 : undefined;
  const stageHeight = naturalSize ? (naturalSize.h * zoomPct) / 100 : undefined;
  const cursor =
    tool === "eraser"
      ? ERASER_CURSOR
      : tool === "pen"
        ? PEN_CURSOR
        : entityDrawRegionId
          ? "crosshair"
          : tool === "pan"
            ? "grab"
            : tool === "select"
              ? "default"
              : "crosshair";

  const isRegionSelected = (id: string) => selectedRegionIds.includes(id);
  const multiSelected = selectedRegionIds.length > 1;
  const regionDrawOrder = regions.map((region, idx) => ({ region, idx })).sort((a, b) => Number(isRegionSelected(a.region.id)) - Number(isRegionSelected(b.region.id)));

  const screenPx = 100 / zoomPct;
  const handleSize = 9 * screenPx;
  const vertexSize = 8 * screenPx;

  // Handles belong to exactly one selected shape — a single region, or an
  // entity. Regions never get handles on the Entities tab (!regionsInteractive)
  // -- there's nothing to resize, since a region's box is final by then.
  const selectedRegion = regionsInteractive && selectedRegionIds.length === 1 ? regions.find((r) => r.id === selectedRegionIds[0]) : undefined;
  const selectedEntity = selectedEntityId ? entities.find((en) => en.id === selectedEntityId) : undefined;
  const handleTarget: { kind: "region" | "entity"; id: string; points: Point[] } | null = selectedEntity
    ? { kind: "entity", id: selectedEntity.id, points: bboxForEntity(selectedEntity) }
    : selectedRegion
      ? { kind: "region", id: selectedRegion.id, points: pointsForRegion(selectedRegion) }
      : null;
  const showHandles = !!handleTarget && tool !== "pan" && tool !== "eraser" && !drawing && !readOnly;

  return (
    <div className={`tracer-stage ${tool === "eraser" ? "tracer-stage--eraser" : tool === "pen" ? "tracer-stage--pen" : ""}`} style={{ width: stageWidth, height: stageHeight }}>
      {IMG_FORMATS.has(format) && <img src={imageUrl} alt={altText} draggable={false} onLoad={handleImageLoad} onError={onImageError} />}
      {format === "pdf" && <PdfBackground url={imageUrl} onReady={handleBackgroundReady} onError={onImageError} onInfo={onInfo} />}
      {format === "dxf" && <DxfBackground url={imageUrl} onReady={handleBackgroundReady} onError={onImageError} />}
      {naturalSize && (
        <svg
          ref={svgRef}
          className="tracer-overlay-svg"
          viewBox={`0 0 ${naturalSize.w} ${naturalSize.h}`}
          preserveAspectRatio="none"
          style={{ cursor }}
          onClick={handleSvgClick}
          onDoubleClick={handleDoubleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Layer 2 — regions */}
          {regionDrawOrder.map(({ region, idx }) => {
            const points = pointsForRegion(region);
            const pointsAttr = points.map(([x, y]) => `${x},${y}`).join(" ");
            const { x0: minX, y0: minY } = boundsOf(points);
            const selected = isRegionSelected(region.id);
            const tagText = `R${idx + 1} ${region.type}`;
            const tagPad = 6 * screenPx;
            const tagH = 18 * screenPx;
            const tagW = Math.max(36 * screenPx, tagText.length * 6.5 * screenPx + tagPad * 2);
            const tagY = minY - tagH - 3 * screenPx < 0 ? minY + 3 * screenPx : minY - tagH - 3 * screenPx;
            return (
              <g key={region.id}>
                <polygon
                  points={pointsAttr}
                  className={
                    "region-shape" +
                    (!regionsInteractive ? " region-shape--faint" : "") +
                    (selected ? " region-shape--selected" : "") +
                    (selected && multiSelected ? " region-shape--multi" : "")
                  }
                  stroke={REGION_COLOR}
                  fill="transparent"
                  pointerEvents={tool === "eraser" ? "none" : undefined}
                  style={{ cursor: !regionsInteractive ? "pointer" : tool === "select" ? "move" : undefined }}
                  onPointerDown={(e) => {
                    if (!regionsInteractive) {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      onArmRegionForEntityDrawing?.(region.id);
                      return;
                    }
                    if (e.metaKey || e.ctrlKey || e.shiftKey) { e.stopPropagation(); onToggleSelectRegion(region.id); return; }
                    if (tool !== "select") return;
                    e.stopPropagation();
                    onSelectRegionOnly(region.id);
                    onSelectEntity(null);
                    if (!readOnly) beginEdit(e, "region", region.id, points, { kind: "move" });
                  }}
                />

                {/* Eraser interactive line segments: hover & click to erase individual line */}
                {tool === "eraser" &&
                  points.map((p, i) => {
                    const nextP = points[(i + 1) % points.length];
                    return (
                      <g key={`erase-edge-${i}`} className="erase-edge-group">
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-visible"
                          stroke="#ef4444"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-hitbox"
                          stroke="transparent"
                          strokeWidth={Math.max(14 * screenPx, 10)}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: ERASER_CURSOR }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleEraseRegionSegment(region.id, i, points);
                          }}
                        />
                      </g>
                    );
                  })}

                <g
                  className={"region-tag-group" + (selected ? " region-tag-group--selected" : "") + (!regionsInteractive ? " region-tag-group--faint" : "")}
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!regionsInteractive) {
                      onArmRegionForEntityDrawing?.(region.id);
                      return;
                    }
                    if (e.metaKey || e.ctrlKey || e.shiftKey) {
                      onToggleSelectRegion(region.id);
                      return;
                    }
                    onSelectRegionOnly(region.id);
                    onSelectEntity(null);
                  }}
                >
                  <rect
                    x={minX}
                    y={tagY}
                    width={tagW}
                    height={tagH}
                    rx={3 * screenPx}
                    className="region-tag-bg"
                  />
                  <text
                    x={minX + tagPad}
                    y={tagY + tagH / 2}
                    className="region-tag-text"
                    style={{ fontSize: `${10.5 * screenPx}px` }}
                  >
                    {tagText}
                  </text>
                </g>
              </g>
            );
          })}

          {/* Layer 3 — entities, drawn smaller/dashed on top of their region */}
          {entities.map((entity) => {
            const bbox = bboxForEntity(entity);
            const pointsAttr = bbox.map(([x, y]) => `${x},${y}`).join(" ");
            const { x0: minX, y0: minY } = boundsOf(bbox);
            const selected = selectedEntityId === entity.id;
            const entText = entity.text || KIND_LABELS[entity.kind];
            // Notes are the bulk of a sheet's text: their labels stay off the canvas unless selected.
            const showTag = entity.kind !== "note" || selected;
            const tagPad = 4 * screenPx;
            const tagH = 15 * screenPx;
            const tagW = Math.max(30 * screenPx, entText.length * 5.8 * screenPx + tagPad * 2);
            const tagY = minY - tagH - 2 * screenPx < 0 ? minY + 2 * screenPx : minY - tagH - 2 * screenPx;
            return (
              <g key={entity.id}>
                <polygon
                  points={pointsAttr}
                  className={
                    "region-shape region-shape--ai" +
                    (selected ? " region-shape--selected" : "") +
                    (entity.status === "suggested" ? " region-shape--suggested" : "")
                  }
                  stroke={ENTITY_COLOR}
                  fill="transparent"
                  pointerEvents={tool === "eraser" ? "none" : undefined}
                  style={{ cursor: tool === "select" ? "move" : undefined }}
                  onPointerDown={(e) => {
                    if (tool !== "select") return;
                    e.stopPropagation();
                    onSelectEntity(entity.id);
                    onSelectRegionOnly(null);
                    if (!readOnly) beginEdit(e, "entity", entity.id, bbox, { kind: "move" });
                  }}
                />

                {/* Eraser interactive line segments for entities */}
                {tool === "eraser" &&
                  bbox.map((p, i) => {
                    const nextP = bbox[(i + 1) % bbox.length];
                    return (
                      <g key={`erase-ent-edge-${i}`} className="erase-edge-group">
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-visible"
                          stroke="#ef4444"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-hitbox"
                          stroke="transparent"
                          strokeWidth={Math.max(14 * screenPx, 10)}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: ERASER_CURSOR }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleEraseEntitySegment(entity.id, i, bbox);
                          }}
                        />
                      </g>
                    );
                  })}

                {showTag && (
                  <g
                    className={"region-tag-group region-tag-group--entity" + (selected ? " region-tag-group--selected" : "")}
                    style={{ cursor: "pointer", pointerEvents: "all" }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelectEntity(entity.id);
                      onSelectRegionOnly(null);
                    }}
                  >
                    <rect
                      x={minX}
                      y={tagY}
                      width={tagW}
                      height={tagH}
                      rx={2.5 * screenPx}
                      className="region-tag-bg"
                    />
                    <text
                      x={minX + tagPad}
                      y={tagY + tagH / 2}
                      className="region-tag-text"
                      style={{ fontSize: `${9 * screenPx}px` }}
                    >
                      {entText}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {showHandles &&
            handleTarget &&
            (() => {
              const points = handleTarget.points;
              const b = boundsOf(points);
              const spots = handlePositions(b);
              const stop = (e: React.SyntheticEvent) => e.stopPropagation();
              const grab = (handle: RectHandle) => (e: React.PointerEvent) => beginEdit(e, handleTarget.kind, handleTarget.id, points, { kind: "rect-handle", handle });
              const strip = Math.min(10 * screenPx, (b.x1 - b.x0) / 3, (b.y1 - b.y0) / 3);
              const edges: { handle: RectHandle; x: number; y: number; w: number; h: number }[] = [
                { handle: "n", x: b.x0, y: b.y0 - strip / 2, w: b.x1 - b.x0, h: strip },
                { handle: "s", x: b.x0, y: b.y1 - strip / 2, w: b.x1 - b.x0, h: strip },
                { handle: "w", x: b.x0 - strip / 2, y: b.y0, w: strip, h: b.y1 - b.y0 },
                { handle: "e", x: b.x1 - strip / 2, y: b.y0, w: strip, h: b.y1 - b.y0 },
              ];
              return (
                <>
                  {!isAxisAlignedRect(points) && <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className="region-bounds" pointerEvents="none" />}
                  {edges.map((edge) => (
                    <rect key={edge.handle} x={edge.x} y={edge.y} width={edge.w} height={edge.h} className="region-edge" pointerEvents="all" style={{ cursor: HANDLE_CURSORS[edge.handle] }} onClick={stop} onPointerDown={grab(edge.handle)} />
                  ))}
                  {(Object.keys(spots) as RectHandle[]).map((handle) => (
                    <rect
                      key={handle}
                      x={spots[handle][0] - handleSize / 2}
                      y={spots[handle][1] - handleSize / 2}
                      width={handleSize}
                      height={handleSize}
                      rx={1.5 * screenPx}
                      ry={1.5 * screenPx}
                      className="region-handle"
                      style={{ cursor: HANDLE_CURSORS[handle] }}
                      onClick={stop}
                      onPointerDown={grab(handle)}
                    />
                  ))}
                  {!isAxisAlignedRect(points) &&
                    points.map(([x, y], index) => (
                      <circle
                        key={index}
                        cx={x}
                        cy={y}
                        r={vertexSize / 2}
                        className="region-handle region-handle--vertex"
                        style={{ cursor: "move" }}
                        onClick={stop}
                        onPointerDown={(e) => beginEdit(e, handleTarget.kind, handleTarget.id, points, { kind: "vertex", index })}
                      />
                    ))}
                </>
              );
            })()}

          {/* Pen tool live drawing / unclosed open draft path */}
          {drawing?.kind === "pen" && drawing.points.length > 0 && (() => {
            const pts = drawing.points;
            const lastPt = pts[pts.length - 1];
            const firstPt = pts[0];
            const strokeColor = entityDrawRegionId ? ENTITY_COLOR : "var(--accent)";
            const isNearStart = Boolean(tool === "pen" && drawing.current && pts.length >= 3 && Math.hypot(drawing.current[0] - firstPt[0], drawing.current[1] - firstPt[1]) <= 6 * screenPx);
            return (
              <g className="pen-drawing-group">
                {pts.length > 1 && (
                  <polyline
                    points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
                    className="draft-shape"
                    stroke={strokeColor}
                    fill="none"
                  />
                )}
                {tool === "pen" && drawing.current && (
                  <line
                    x1={lastPt[0]}
                    y1={lastPt[1]}
                    x2={isNearStart ? firstPt[0] : drawing.current[0]}
                    y2={isNearStart ? firstPt[1] : drawing.current[1]}
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                {pts.map(([x, y], i) => (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={3 * screenPx}
                    fill={i === 0 ? strokeColor : "#ffffff"}
                    stroke={strokeColor}
                    strokeWidth={1.5 * screenPx}
                  />
                ))}
                {isNearStart && (
                  <circle
                    cx={firstPt[0]}
                    cy={firstPt[1]}
                    r={6 * screenPx}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                )}
                {/* Interactive line segments on draft path for eraser */}
                {tool === "eraser" &&
                  pts.slice(0, -1).map((p, i) => {
                    const nextP = pts[i + 1];
                    return (
                      <g key={`erase-draft-edge-${i}`} className="erase-edge-group">
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-visible"
                          stroke="#ef4444"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                        <line
                          x1={p[0]}
                          y1={p[1]}
                          x2={nextP[0]}
                          y2={nextP[1]}
                          className="erase-edge-hitbox"
                          stroke="transparent"
                          strokeWidth={Math.max(14 * screenPx, 10)}
                          vectorEffect="non-scaling-stroke"
                          style={{ cursor: ERASER_CURSOR }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            handleEraseDraftSegment(i);
                          }}
                        />
                      </g>
                    );
                  })}
              </g>
            );
          })()}

          {drawing?.kind === "box" && (
            <rect
              x={Math.min(drawing.start[0], drawing.cur[0])}
              y={Math.min(drawing.start[1], drawing.cur[1])}
              width={Math.abs(drawing.cur[0] - drawing.start[0])}
              height={Math.abs(drawing.cur[1] - drawing.start[1])}
              className="draft-shape"
              fill="transparent"
              stroke={entityDrawRegionId ? ENTITY_COLOR : "var(--accent)"}
            />
          )}
        </svg>
      )}
    </div>
  );
}
