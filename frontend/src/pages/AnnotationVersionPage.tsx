import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStudio } from "../context/StudioContext";

import {
  ApiError,
  approveAnnotationVersion,
  createEntity,
  createRegionForVersion,
  deleteAnnotationVersion,
  deleteEntity,
  deleteRegionForVersion,
  confirmRegionSuggestions,
  extractEntitiesForVersion,
  fetchDrawingContentBlob,
  getAnnotationVersion,
  getDrawing,
  mergeRegionsForVersion,
  resumeDrawing,
  startNewVersion,
  updateAnnotationVersion,
  updateDrawing,
  updateEntity,
  updateRegionForVersion,
} from "../api/client";
import {
  IconCanvas,
  IconCheck,
  IconEdit,
  IconLayers,
  IconRedo,
  IconTrash,
  IconUndo,
} from "../components/Icons";
import { AnnotationTracerCanvas, type Tool } from "../components/AnnotationTracerCanvas";
import { EntitiesTab } from "../components/EntitiesTab";
import { MetadataModal, type MetadataModalDefaults } from "../components/MetadataModal";
import { RegionsTab } from "../components/RegionsTab";
import { UploadDropzone } from "../components/UploadDropzone";
import { DeleteDrawingWarningModal, VersionHistoryPanel } from "../components/VersionHistoryPanel";
import type { Entity, EntityKind, Point, Region } from "../types/annotation";
import { boundsOf } from "../lib/regionEdit";
import type { AnnotationVersion, AnnotationVersionUpdate, DrawingOut } from "../types/drawing";

// Same set backend/app/services/classification.py calls TRACEABLE_FORMATS —
// duplicated here (not imported from types/file.ts) to keep this new system
// free of any dependency on the old one.
const TRACEABLE_FORMATS = new Set(["png", "jpg", "jpeg", "svg", "pdf", "dxf"]);

interface ToolDef {
  id: Tool;
  label: string;
  shortcut: string;
  icon: JSX.Element;
}

const TOOLS: ToolDef[] = [
  {
    id: "pen",
    label: "Pen",
    shortcut: "P",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    ),
  },
  {
    id: "box",
    label: "Box",
    shortcut: "B",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="2" />
      </svg>
    ),
  },
  {
    id: "select",
    label: "Select",
    shortcut: "V",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m3 3 7 18 3-7 7-3L3 3z" />
      </svg>
    ),
  },
  {
    id: "eraser",
    label: "Eraser",
    shortcut: "E",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ overflow: "visible" }}>
        <g transform="translate(0.5, 0.5) scale(0.92)">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </g>
      </svg>
    ),
  },
  {
    id: "pan",
    label: "Pan",
    shortcut: "H",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
        <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
        <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
        <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
      </svg>
    ),
  },
];

/** An entity's content as it was, for undo/redo. */
type EntitySnapshot = {
  kind: EntityKind;
  subtype: string | null;
  text: string | null;
  region_id: string | null;
  bbox: Point[];
};

type HistoryEntry =
  | {
      type: "create_region";
      regionId: string;
      regionData: { type: string; points: Point[]; caption?: string | null; notes?: string | null; status?: string };
    }
  | {
      type: "delete_region";
      regionData: { type: string; points: Point[]; caption?: string | null; notes?: string | null; status?: string };
      entitiesData: EntitySnapshot[];
    }
  | {
      type: "update_region_points";
      regionId: string;
      prevPoints: Point[];
      nextPoints: Point[];
    }
  | {
      type: "create_entity";
      entityId: string;
      entityData: EntitySnapshot;
    }
  | {
      type: "delete_entity";
      entityData: EntitySnapshot;
    }
  | {
      type: "update_entity_bbox";
      entityId: string;
      prevBbox: Point[];
      nextBbox: Point[];
    };

/**
 * The full annotation workspace for one version: Layer 1 metadata (§5 step
 * 3; captured via the blocking MetadataModal rather than an inline form as
 * of PHASE2_IMPLEMENTATION_PLAN.md slice 3), Layer 2 coarse regions and
 * Layer 3 structured entities (§5 steps 4-5, slice 4), drawing completion
 * (§5 step 6, slice 5), and version history (§5 step 7, this slice). The
 * tracer's drawing mechanics are the same ones the old /files workspace
 * used (Pen/Box/Select/Pan, drag-to-move, drag-edge-to-resize) — reused as
 * pure math (lib/regionEdit.ts) and re-implemented against the new, simpler
 * schema in AnnotationTracerCanvas, since the old TracerCanvas component is
 * now tightly coupled to an earlier prototype's fields.
 *
 * An approved version is read-only here — no Layer 1 edits (the metadata
 * modal only ever renders for a non-approved version), no drawing or
 * moving/resizing regions/entities, no merge/delete. The *only* way to
 * change it is "Enable editing" (PHASE2_IMPLEMENTATION_PLAN.md §2.5 --
 * same startNewVersion API call as Phase 1's "Start new version," just
 * relabeled, and since slice 6 it copies every region/entity/Layer-1
 * field forward instead of starting blank), which forks a new draft and
 * navigates there; the approved version itself is never touched again.
 * Viewing a past (non-current) version is always read-only too, with no
 * fork option — only the drawing's current version can be forked.
 */
export function AnnotationVersionPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { setStudio, clearStudio } = useStudio();

  const [version, setVersion] = useState<AnnotationVersion | null>(null);
  const readOnly = version?.status === "approved";
  const [drawing, setDrawing] = useState<DrawingOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("box");
  const [zoomPct, setZoomPct] = useState(100);
  const [mobileTab, setMobileTab] = useState<"canvas" | "annotations">("canvas");

  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const isHistoryOperation = useRef(false);

  function pushHistory(entry: HistoryEntry) {
    if (isHistoryOperation.current) return;
    setUndoStack((prev) => [...prev.slice(-40), entry]);
    setRedoStack([]);
  }
  // --- Guided two-phase flow (§2.2-2.3, slice 4) ---
  // "regions": Tab 1, drawing/describing Layer 2 zones. "entities": Tab 2,
  // marking up Layer 3 content inside each already-drawn region.
  const [activeTab, setActiveTab] = useState<"regions" | "entities">("regions");
  // Which region's full edit panel is open on the Regions tab -- a
  // not-yet-done region is always shown open regardless of this; this only
  // controls whether an already-done one is expanded back open (§2.2 step 7).
  const [expandedRegionId, setExpandedRegionId] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [selectedRegionIds, setSelectedRegionIds] = useState<string[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [entityDrawRegionId, setEntityDrawRegionId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [contentUrl, setContentUrl] = useState<string | null>(null);
  const [contentError, setContentError] = useState(false);
  const [infoNote, setInfoNote] = useState<string | null>(null);
  const [startingVersion, setStartingVersion] = useState(false);
  // --- Version deletion (§2.5 step 20, §4.3, slice 7) ---
  // Single id, not a per-row flag, because only one delete action can be
  // armed at a time -- clicking a different one just re-targets it.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // The distinct, more serious confirmation for deleting a drawing's only
  // remaining version (§4.3 point 3) -- a modal, not the quick two-click
  // pattern the ordinary case uses below.
  const [lastVersionWarningOpen, setLastVersionWarningOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // --- Layer 1 metadata modal (§2.1, slice 3) ---
  const [metadataModalOpen, setMetadataModalOpen] = useState(false);
  const [metadataPrefill, setMetadataPrefill] = useState<MetadataModalDefaults | null>(null);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  // State mirror of the viewport element, so the wheel effect re-attaches whenever
  // the element is mounted or replaced (it's rendered only after the version loads).
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);

  // `isInitialLoad` is only true for the one refresh() call that follows
  // actually navigating to this versionId (see the effect below). Every
  // other call -- after creating a region, toggling a checkbox, and so on
  // -- goes through this same function to re-sync state from the server,
  // but must NOT re-run the one-time "which tab/modal should this open on"
  // decisions below, or finishing a single region would, e.g., silently
  // snap the person back to a tab they'd deliberately navigated away from.
  async function refresh(isInitialLoad = false) {
    if (!versionId) return;
    try {
      const v = await getAnnotationVersion(versionId);
      setVersion(v);
      if (isInitialLoad) {
        // Every non-approved version opens behind the metadata modal --
        // true every time this page loads a draft, not just on first
        // entry, since a page reload re-mounts this component with
        // nothing to distinguish "already confirmed earlier" from "never
        // confirmed."
        setMetadataModalOpen(v.status !== "approved");
        // Land on whichever tab matches how far this version already got
        // (§2.2-2.3) -- e.g. reopening a draft whose regions are all done
        // opens straight on Entities, not back at the start.
        const regionsPhaseDone = v.regions.length > 0 && v.regions.every((r) => r.status === "done");
        setActiveTab(regionsPhaseDone ? "entities" : "regions");
      }

      const d = await getDrawing(v.drawing_id);
      setDrawing(d);

      if (isInitialLoad) {
        // Pre-fill-on-fork (§2.1 step 5): a freshly forked version has no
        // Layer 1 fields of its own yet (copy-forward of those is slice 6's
        // job) -- so if every field is still blank, look up the version this
        // one was forked from and offer ITS values as the modal's starting
        // point. Still editable, still must be explicitly submitted.
        const layer1IsBlank = v.standard == null && v.units == null && v.discipline == null && v.scale == null && v.general_tolerance_grade == null;
        if (layer1IsBlank && v.version_number > 1) {
          const forkedFrom = d.annotation_versions.find((sib) => sib.superseded_by_id === v.id);
          if (forkedFrom) {
            const full = await getAnnotationVersion(forkedFrom.id);
            setMetadataPrefill({
              standard: full.standard,
              units: full.units,
              discipline: full.discipline,
              scale: full.scale,
              general_tolerance_grade: full.general_tolerance_grade,
            });
          }
        }
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  // §5a: "preview expired — please re-upload" (slice 8). Narrower than the
  // general upload flow -- resumeDrawing confirms server-side that the
  // bytes dropped in actually match *this* drawing's content_hash before
  // restoring anything, so a wrong file gets a clear error instead of
  // silently resuming (or creating) something unrelated. Never touches
  // annotation_versions/regions/entities -- only the cached preview bytes
  // were ever at risk.
  async function handleResumeUpload(files: File[]) {
    if (!drawing || files.length === 0) return;
    setResuming(true);
    setResumeError(null);
    try {
      const updated = await resumeDrawing(drawing.id, files[0]);
      setDrawing(updated);
    } catch (err) {
      setResumeError(
        err instanceof ApiError && err.status === 400
          ? err.message
          : describeError(err),
      );
    } finally {
      setResuming(false);
    }
  }

  useEffect(() => {
    // React Router reuses this same component instance across navigations
    // between two /annotation-versions/:versionId URLs (same route pattern)
    // -- it does NOT remount on a versionId change, so every bit of local
    // state has to be reset here explicitly or it leaks from the previous
    // version into the next (e.g. "Starting…" staying stuck on a freshly
    // navigated-to version after forking away from a different one).
    setLoading(true);
    setError(null);
    setSelectedRegionIds([]);
    setSelectedEntityId(null);
    setEntityDrawRegionId(null);
    setNaturalSize(null);
    setStartingVersion(false);
    setConfirmingDeleteId(null);
    setDeletingId(null);
    setLastVersionWarningOpen(false);
    setMetadataModalOpen(false);
    setMetadataPrefill(null);
    setMetadataError(null);
    setExpandedRegionId(null);
    setEntityDrawRegionId(null);
    refresh(true);
    // Register the studio tab as soon as we know this versionId (drawing name
    // will be filled in by the effect below once the drawing data arrives).
    setStudio(versionId ?? null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  // Approved versions are read-only — don't leave the tool on Pen/Box
  // (whose buttons aren't even shown) from a previous, editable version.
  useEffect(() => {
    if (version?.status === "approved") setTool("select");
  }, [version?.status]);

  // Keep StudioContext's drawing name in sync whenever `drawing` changes.
  useEffect(() => {
    if (drawing && versionId) {
      setStudio(versionId, drawing.original_filename);
    }
  }, [drawing, versionId, setStudio]);

  useEffect(() => {
    if (!drawing || !drawing.stored) {
      setContentUrl(null);
      setContentError(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setContentUrl(null);
    setContentError(false);
    fetchDrawingContentBlob(drawing.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setContentUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setContentError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing?.id, drawing?.stored]);

  const zoomPctRef = useRef(zoomPct);
  // Smooth wheel zoom: wheel input moves the target; a frame loop eases the zoom toward it.
  const zoomTargetRef = useRef(zoomPct);
  const zoomAnimRef = useRef<number | null>(null);
  const zoomAnchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Scroll to apply right after React has committed the new stage size.
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const p = pendingScrollRef.current;
    const vp = viewportRef.current;
    if (p && vp) {
      vp.scrollLeft = Math.max(0, p.left);
      vp.scrollTop = Math.max(0, p.top);
      pendingScrollRef.current = null;
    }
  });

  /** Stops any in-flight wheel animation, so a button or fit action isn't fought by it. */
  function cancelZoomAnimation() {
    if (zoomAnimRef.current !== null) {
      cancelAnimationFrame(zoomAnimRef.current);
      zoomAnimRef.current = null;
    }
    zoomTargetRef.current = zoomPctRef.current;
  }
  useEffect(() => {
    zoomPctRef.current = zoomPct;
  }, [zoomPct]);

  function setZoom(pct: number) {
    cancelZoomAnimation();
    const currentZoom = zoomPctRef.current;
    const newZoom = Math.max(10, Math.min(500, Math.round(pct)));
    if (newZoom === currentZoom) return;

    const vp = viewportRef.current;
    if (vp) {
      const centerX = vp.clientWidth / 2;
      const centerY = vp.clientHeight / 2;
      const scaleRatio = newZoom / currentZoom;
      const newScrollLeft = (vp.scrollLeft + centerX) * scaleRatio - centerX;
      const newScrollTop = (vp.scrollTop + centerY) * scaleRatio - centerY;
      setZoomPct(newZoom);
      zoomPctRef.current = newZoom;
      requestAnimationFrame(() => {
        if (viewportRef.current) {
          viewportRef.current.scrollLeft = Math.max(0, newScrollLeft);
          viewportRef.current.scrollTop = Math.max(0, newScrollTop);
        }
      });
    } else {
      setZoomPct(newZoom);
      zoomPctRef.current = newZoom;
    }
  }

  function fitZoom(size: { w: number; h: number }) {
    cancelZoomAnimation();
    const vp = viewportRef.current;
    if (!vp) return;
    const padding = 32;
    const availW = Math.max(100, vp.clientWidth - padding);
    const availH = Math.max(100, vp.clientHeight - padding);
    const scaleX = availW / size.w;
    const scaleY = availH / size.h;
    const fitScale = Math.min(scaleX, scaleY > 0 ? scaleY : scaleX);
    const newZoom = Math.max(10, Math.min(500, Math.round(fitScale * 100)));
    setZoomPct(newZoom);
    zoomPctRef.current = newZoom;
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollLeft = 0;
        viewportRef.current.scrollTop = 0;
      }
    });
  }

  useEffect(() => {
    if (naturalSize) fitZoom(naturalSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize]);

  // Support mouse wheel / trackpad zoom directly on the drawing viewport, anchored at cursor,
  // preventing browser whole-page zoom on laptops
  useEffect(() => {
    const vp = viewportEl;
    if (!vp) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent browser page zoom and bounce
      e.preventDefault();
      e.stopPropagation();

      const rect = vp.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let factor = 1;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch on Mac / Windows produces wheel events with ctrlKey.
        // Clamp so one mouse-wheel notch (deltaY ~120) is a gentle step, not a 6x jump.
        const dy = Math.max(-40, Math.min(40, e.deltaY));
        factor = Math.exp(-dy * 0.01);
      } else {
        // Standard mouse wheel
        factor = e.deltaY < 0 ? 1.12 : 0.88;
      }

      // Build on the target if an animation is already running, so fast scrolling adds up.
      const base = zoomAnimRef.current !== null ? zoomTargetRef.current : zoomPctRef.current;
      const target = Math.max(10, Math.min(500, base * factor));
      if (Math.abs(target - base) < 0.01) return;
      zoomTargetRef.current = target;
      zoomAnchorRef.current = { x: mouseX, y: mouseY };

      if (zoomAnimRef.current === null) {
        zoomAnimRef.current = requestAnimationFrame(stepZoom);
      }
    };

    /** One animation frame: ease the zoom a fraction of the way to the target,
     * keeping the point under the cursor where it is. */
    const stepZoom = () => {
      zoomAnimRef.current = null;
      const cur = zoomPctRef.current;
      const tgt = zoomTargetRef.current;
      let next = cur + (tgt - cur) * 0.25;
      if (Math.abs(tgt - next) < 0.05) next = tgt;

      if (next !== cur) {
        const { x, y } = zoomAnchorRef.current;
        const ratio = next / cur;
        pendingScrollRef.current = {
          left: (vp.scrollLeft + x) * ratio - x,
          top: (vp.scrollTop + y) * ratio - y,
        };
        zoomPctRef.current = next;
        setZoomPct(next);
      }
      if (next !== tgt) {
        zoomAnimRef.current = requestAnimationFrame(stepZoom);
      }
    };

    // Safari on macOS uses gesture events for trackpad pinch
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    vp.addEventListener("wheel", handleWheel, { passive: false });
    vp.addEventListener("gesturestart" as any, preventGesture, { passive: false });
    vp.addEventListener("gesturechange" as any, preventGesture, { passive: false });
    vp.addEventListener("gestureend" as any, preventGesture, { passive: false });

    // Prevent whole-window browser pinch zoom when hovering near canvas
    const handleWindowWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const target = e.target as HTMLElement | null;
        if (target && (target.closest(".canvas-card") || target.closest(".tracer-wrap"))) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener("wheel", handleWindowWheel, { passive: false });

    return () => {
      vp.removeEventListener("wheel", handleWheel);
      vp.removeEventListener("gesturestart" as any, preventGesture);
      vp.removeEventListener("gesturechange" as any, preventGesture);
      vp.removeEventListener("gestureend" as any, preventGesture);
      window.removeEventListener("wheel", handleWindowWheel);
      if (zoomAnimRef.current !== null) cancelAnimationFrame(zoomAnimRef.current);
      zoomAnimRef.current = null;
    };
  }, [viewportEl]);

  const regions = version?.regions ?? [];
  const entities = version?.entities ?? [];
  const validSelectedRegionIds = selectedRegionIds.filter((id) => regions.some((r) => r.id === id));

  /** Zooms the viewer so a shape fills `fill` of the visible area, then centres
   * it: callouts at half (so the value is readable), regions at most of it (so
   * the whole view is visible). Zoom stays within the viewer's limits (10%-500%). */
  function zoomToShape(points: Point[], fill = 0.5) {
    cancelZoomAnimation();
    const vp = viewportRef.current;
    if (!vp || !points || points.length === 0) return;
    const { x0, y0, x1, y1 } = boundsOf(points);
    const w = Math.max(x1 - x0, 1);
    const h = Math.max(y1 - y0, 1);
    const fit = Math.min((vp.clientWidth * fill) / w, (vp.clientHeight * fill) / h) * 100;
    const newZoom = Math.max(10, Math.min(500, Math.round(fit)));
    const centerX = ((x0 + x1) / 2 * newZoom) / 100;
    const centerY = ((y0 + y1) / 2 * newZoom) / 100;
    setZoomPct(newZoom);
    zoomPctRef.current = newZoom;
    // The stage resizes on the next render, so the scroll position is set after it.
    requestAnimationFrame(() => {
      const el = viewportRef.current;
      if (!el) return;
      el.scrollLeft = Math.max(0, centerX - el.clientWidth / 2);
      el.scrollTop = Math.max(0, centerY - el.clientHeight / 2);
    });
  }

  function selectRegionOnly(id: string | null) {
    setSelectedRegionIds(id ? [id] : []);
    if (id) {
      setExpandedRegionId(id);
      requestAnimationFrame(() => {
        const el = document.getElementById(`region-item-${id}`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  function toggleSelectRegion(id: string) {
    setSelectedRegionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Keyboard shortcuts:
  // - Ctrl/Cmd + P: Pen
  // - Ctrl/Cmd + B: Box
  // - Ctrl/Cmd + E: Eraser
  // - Esc: clear selection
  // - Delete/Backspace: delete selected entity or regions
  // - Cmd/Ctrl + Z: undo, Cmd/Ctrl + Shift + Z: redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const isInput = !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Zoom shortcuts: Ctrl/Cmd + "+" / "=" / "-" / "0" zoom the drawing,
      // never the whole browser page
      if (isMod && !e.altKey && (key === "+" || key === "=" || key === "-" || key === "0")) {
        e.preventDefault();
        if (key === "0") setZoom(100);
        else if (key === "-") setZoom(zoomPctRef.current / 1.25);
        else setZoom(zoomPctRef.current * 1.25);
        return;
      }

      // Tool shortcuts: Ctrl/Cmd + P, Ctrl/Cmd + B, Ctrl/Cmd + E
      if (isMod && !e.shiftKey && !e.altKey) {
        if (key === "p") {
          e.preventDefault();
          if (!readOnly) setTool("pen");
          return;
        }
        if (key === "b") {
          e.preventDefault();
          if (!readOnly) setTool("box");
          return;
        }
        if (key === "e") {
          e.preventDefault();
          if (!readOnly) setTool("eraser");
          return;
        }
      }

      if (isInput) return;

      // Plain single-letter shortcuts when not typing in an input
      if (!isMod && !e.shiftKey && !e.altKey) {
        if (key === "p" && !readOnly) {
          e.preventDefault();
          setTool("pen");
          return;
        }
        if (key === "b" && !readOnly) {
          e.preventDefault();
          setTool("box");
          return;
        }
        if (key === "e" && !readOnly) {
          e.preventDefault();
          setTool("eraser");
          return;
        }
        if (key === "v") {
          e.preventDefault();
          setTool("select");
          return;
        }
        if (key === "h") {
          e.preventDefault();
          setTool("pan");
          return;
        }
      }

      if (isMod && !e.shiftKey && key === "z") {
        e.preventDefault();
        void handleUndo();
      } else if (
        (isMod && e.shiftKey && key === "z") ||
        (isMod && key === "y")
      ) {
        e.preventDefault();
        void handleRedo();
      } else if (e.key === "Escape") {
        setSelectedRegionIds([]);
        setSelectedEntityId(null);
        setEntityDrawRegionId(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEntityId) {
          e.preventDefault();
          handleDeleteEntity(selectedEntityId);
        } else if (activeTab === "regions" && validSelectedRegionIds.length > 0) {
          e.preventDefault();
          handleDeleteRegions(validSelectedRegionIds);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegionIds, selectedEntityId, version, activeTab, undoStack, redoStack, readOnly]);

  async function handleUndo() {
    if (!versionId || undoStack.length === 0 || readOnly) return;
    const entry = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    isHistoryOperation.current = true;
    try {
      if (entry.type === "create_region") {
        await deleteRegionForVersion(versionId, entry.regionId);
        setRedoStack((prev) => [...prev, entry]);
      } else if (entry.type === "delete_region") {
        const restored = await createRegionForVersion(versionId, {
          type: entry.regionData.type,
          points: entry.regionData.points,
          caption: entry.regionData.caption ?? undefined,
          notes: entry.regionData.notes ?? undefined,
          status: (entry.regionData.status as any) ?? undefined,
          source: "human",
        });
        for (const ent of entry.entitiesData) {
          await createEntity(versionId, {
            kind: ent.kind,
            subtype: ent.subtype,
            text: ent.text,
            region_id: restored.id,
            bbox: ent.bbox,
          });
        }
        setRedoStack((prev) => [...prev, { ...entry, regionId: restored.id }]);
      } else if (entry.type === "update_region_points") {
        await updateRegionForVersion(versionId, entry.regionId, { points: entry.prevPoints });
        setRedoStack((prev) => [...prev, entry]);
      } else if (entry.type === "create_entity") {
        await deleteEntity(versionId, entry.entityId);
        setRedoStack((prev) => [...prev, entry]);
      } else if (entry.type === "delete_entity") {
        const restored = await createEntity(versionId, {
          kind: entry.entityData.kind,
          subtype: entry.entityData.subtype,
          text: entry.entityData.text,
          region_id: entry.entityData.region_id,
          bbox: entry.entityData.bbox,
        });
        setRedoStack((prev) => [...prev, { ...entry, entityId: restored.id }]);
      } else if (entry.type === "update_entity_bbox") {
        await updateEntity(versionId, entry.entityId, { bbox: entry.prevBbox });
        setRedoStack((prev) => [...prev, entry]);
      }
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      isHistoryOperation.current = false;
    }
  }

  async function handleRedo() {
    if (!versionId || redoStack.length === 0 || readOnly) return;
    const entry = redoStack[redoStack.length - 1];
    setRedoStack((prev) => prev.slice(0, -1));
    isHistoryOperation.current = true;
    try {
      if (entry.type === "create_region") {
        const restored = await createRegionForVersion(versionId, {
          type: entry.regionData.type,
          points: entry.regionData.points,
          caption: entry.regionData.caption ?? undefined,
          notes: entry.regionData.notes ?? undefined,
          status: (entry.regionData.status as any) ?? undefined,
          source: "human",
        });
        setUndoStack((prev) => [...prev, { ...entry, regionId: restored.id }]);
      } else if (entry.type === "delete_region") {
        const targetId = (entry as any).regionId;
        if (targetId) await deleteRegionForVersion(versionId, targetId);
        setUndoStack((prev) => [...prev, entry]);
      } else if (entry.type === "update_region_points") {
        await updateRegionForVersion(versionId, entry.regionId, { points: entry.nextPoints });
        setUndoStack((prev) => [...prev, entry]);
      } else if (entry.type === "create_entity") {
        const restored = await createEntity(versionId, {
          kind: entry.entityData.kind,
          subtype: entry.entityData.subtype,
          text: entry.entityData.text,
          region_id: entry.entityData.region_id,
          bbox: entry.entityData.bbox,
        });
        setUndoStack((prev) => [...prev, { ...entry, entityId: restored.id }]);
      } else if (entry.type === "delete_entity") {
        const targetId = (entry as any).entityId;
        if (targetId) await deleteEntity(versionId, targetId);
        setUndoStack((prev) => [...prev, entry]);
      } else if (entry.type === "update_entity_bbox") {
        await updateEntity(versionId, entry.entityId, { bbox: entry.nextBbox });
        setUndoStack((prev) => [...prev, entry]);
      }
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      isHistoryOperation.current = false;
    }
  }

  async function handleSaveMetadata(patch: AnnotationVersionUpdate) {
    if (!versionId) return;
    setSavingMetadata(true);
    setMetadataError(null);
    try {
      const updated = await updateAnnotationVersion(versionId, patch);
      setVersion((prev) => (prev ? { ...prev, ...updated, regions: prev.regions, entities: prev.entities } : updated));
      setMetadataModalOpen(false);
      setMetadataPrefill(null);
      flashSaved();
    } catch (err) {
      setMetadataError(describeError(err));
    } finally {
      setSavingMetadata(false);
    }
  }

  async function saveSourceLink(value: string) {
    if (!drawing) return;
    try {
      const updated = await updateDrawing(drawing.id, { source_link: value || null });
      setDrawing(updated);
      flashSaved();
    } catch (err) {
      setError(describeError(err));
    }
  }

  function flashSaved() {
    setSavedNote("Saved.");
    setTimeout(() => setSavedNote(null), 2000);
  }

  // --- Layer 2: regions ---

  async function handleCreateRegion(points: Point[]) {
    if (!versionId) return;
    try {
      const created = await createRegionForVersion(versionId, { type: "view", points, source: "human" });
      pushHistory({
        type: "create_region",
        regionId: created.id,
        regionData: { type: created.type, points: created.points, caption: created.caption, notes: created.notes, status: created.status },
      });
      setSelectedRegionIds([created.id]);
      setSelectedEntityId(null);
      setTool("select");
      // §2.2 step 6: "as soon as a box is drawn, a small panel opens for
      // that region" -- open its edit panel immediately.
      setExpandedRegionId(created.id);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  /** The Regions tab's Done checkbox (§2.2 step 7): saves, flips `status`,
   * and -- only when checking it on -- collapses the panel back down. */
  async function handleToggleRegionDone(id: string, done: boolean) {
    if (!versionId) return;
    try {
      await updateRegionForVersion(versionId, id, { status: done ? "done" : "in_progress" });
      if (done) setExpandedRegionId((prev) => (prev === id ? null : prev));
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleUpdateRegionPoints(id: string, points: Point[]) {
    if (!versionId) return;
    const existing = regions.find((r) => r.id === id);
    if (existing) {
      pushHistory({
        type: "update_region_points",
        regionId: id,
        prevPoints: existing.points,
        nextPoints: points,
      });
    }
    try {
      await updateRegionForVersion(versionId, id, { points });
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleRegionChange(id: string, patch: Partial<Pick<Region, "type" | "caption" | "notes" | "status">>) {
    if (!versionId) return;
    try {
      await updateRegionForVersion(versionId, id, patch);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDeleteRegions(ids: string[]) {
    if (!versionId || ids.length === 0) return;
    for (const id of ids) {
      const region = regions.find((r) => r.id === id);
      if (region) {
        const regionEntities = entities.filter((e) => e.region_id === id);
        pushHistory({
          type: "delete_region",
          regionData: { type: region.type, points: region.points, caption: region.caption, notes: region.notes, status: region.status },
          entitiesData: regionEntities.map((e) => ({ kind: e.kind, subtype: e.subtype, text: e.text, region_id: e.region_id, bbox: e.bbox })),
        });
      }
      try {
        await deleteRegionForVersion(versionId, id);
      } catch (err) {
        setError(describeError(err));
      }
    }
    setSelectedRegionIds((prev) => prev.filter((x) => !ids.includes(x)));
    await refresh();
  }

  async function handleMerge() {
    if (!versionId || validSelectedRegionIds.length < 2) return;
    try {
      const merged = await mergeRegionsForVersion(versionId, validSelectedRegionIds);
      setInfoNote(`Merged ${validSelectedRegionIds.length} regions into one — its box covers all of them. Their entities now belong to the merged region.`);
      setSelectedRegionIds([merged.id]);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  // --- Layer 3: entities ---

  async function handleCreateEntity(regionId: string, bbox: Point[]) {
    if (!versionId) return;
    try {
      const created = await createEntity(versionId, { kind: "other", region_id: regionId, bbox });
      pushHistory({
        type: "create_entity",
        entityId: created.id,
        entityData: { kind: created.kind, subtype: created.subtype, text: created.text, region_id: created.region_id, bbox: created.bbox },
      });
      // Deliberately keep entityDrawRegionId set to `regionId` here (not
      // cleared to null) -- §2.3 step 12 has the person draw every entity
      // inside a region before moving on, so the Entities tab must stay on
      // that region's own entity list, not bounce back out to the region
      // picker after just the first box. Only the explicit "back" / "done
      // with this region" actions clear it.
      setSelectedEntityId(created.id);
      setSelectedRegionIds([]);
      setTool("select");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleUpdateEntityBbox(id: string, bbox: Point[]) {
    if (!versionId) return;
    const existing = entities.find((e) => e.id === id);
    if (existing) {
      pushHistory({
        type: "update_entity_bbox",
        entityId: id,
        prevBbox: existing.bbox,
        nextBbox: bbox,
      });
    }
    try {
      await updateEntity(versionId, id, { bbox });
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleEntityChange(id: string, patch: Partial<Pick<Entity, "kind" | "subtype" | "region_id" | "text" | "status">>) {
    if (!versionId) return;
    try {
      await updateEntity(versionId, id, patch);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleDeleteEntity(id: string) {
    if (!versionId) return;
    const entity = entities.find((e) => e.id === id);
    if (entity) {
      pushHistory({
        type: "delete_entity",
        entityData: { kind: entity.kind, subtype: entity.subtype, text: entity.text, region_id: entity.region_id, bbox: entity.bbox },
      });
    }
    try {
      await deleteEntity(versionId, id);
      if (selectedEntityId === id) setSelectedEntityId(null);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  /** Entities tab (§2.3 step 11): arms a region for entity drawing --
   * whether triggered by clicking it on the canvas or picking it in the
   * sidebar list. Also flips its entities_status to in_progress the first
   * time, so that state reflects reality even before any entity exists. */
  async function handleArmRegionForEntityDrawing(regionId: string) {
    setEntityDrawRegionId(regionId);
    // Deliberately NOT setSelectedRegionIds([regionId]) here -- that state
    // also drives the Delete-key handler below, and a region must never
    // be deletable from the Entities tab. The canvas highlights the armed
    // region from entityDrawRegionId directly instead (see its
    // selectedRegionIds prop just below in the JSX).
    setSelectedRegionIds([]);
    setSelectedEntityId(null);
    // A read-only (approved) version can still "arm" a region to browse
    // its entities -- just never starts a draw tool or touches
    // entities_status, since nothing here is editable.
    if (version?.status === "approved") return;
    // Select by default, so every callout box can be clicked and resized right away.
    // Drawing a new box is an explicit choice (Box tool, B).
    setTool("select");
    const region = regions.find((r) => r.id === regionId);
    if (versionId && region && region.entities_status === "not_started") {
      try {
        await updateRegionForVersion(versionId, regionId, { entities_status: "in_progress" });
        await refresh();
      } catch (err) {
        setError(describeError(err));
      }
    }
  }

  /** Reads the sheet's text and turns each line inside a region into a
   * suggested entity. The server only does this once per region, so it's
   * safe to call every time the Entities tab is shown. */
  // One extraction request at a time per version. React's StrictMode runs the
  // effect below twice in development, and a second request must not race the first.
  const extractionInFlight = useRef<Promise<void> | null>(null);

  async function runEntityExtraction() {
    if (!versionId) return;
    if (extractionInFlight.current) return extractionInFlight.current;
    const run = (async () => {
      try {
        const result = await extractEntitiesForVersion(versionId);
        if (result.running) {
          // The server reads the sheet in the background (this can take a minute).
          // Poll until every region is finished, so the callouts appear by themselves.
          setInfoNote("Reading the sheet for text… callouts will appear when it's done.");
          for (let i = 0; i < 180; i++) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
            const latest = await getAnnotationVersion(versionId);
            await refresh();
            if (!latest.regions.some((r) => r.extraction_status === "running")) break;
          }
        }
        const finalState = await getAnnotationVersion(versionId);
        const note = finalState.regions.map((r) => r.extraction_note).find((n) => !!n);
        const found = finalState.entities.filter((e) => e.status === "suggested").length;
        if (note) setInfoNote(`${note}.`);
        else if (found > 0) setInfoNote(`${found} text item${found === 1 ? "" : "s"} found on the sheet. Name each one or delete it.`);
        else setInfoNote(null);
        // Always reload: the callouts may have been written by an earlier request.
        await refresh();
      } catch (err) {
        setError(describeError(err));
      } finally {
        extractionInFlight.current = null;
      }
    })();
    extractionInFlight.current = run;
    return run;
  }

  // "Proceed to entity annotation" and reopening a version that's already past
  // the region phase both land here, so extraction always runs on entry.
  useEffect(() => {
    if (activeTab !== "entities" || !versionId || readOnly) return;
    void runEntityExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, versionId, readOnly]);

  function handleProceedToEntities() {
    setActiveTab("entities");
    setSelectedRegionIds([]);
  }

  /** Confirms every suggestion in a region that the parser had no doubts about. */
  async function handleConfirmClean(regionId: string) {
    if (!versionId) return;
    try {
      await confirmRegionSuggestions(versionId, regionId, true);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  /** The Entities tab's per-region "Done" button (§2.3 step 13): marks
   * that region's entity phase complete and returns to the region list. */
  async function handleMarkRegionEntitiesDone(regionId: string) {
    if (!versionId) return;
    try {
      await updateRegionForVersion(versionId, regionId, { entities_status: "done" });
      setEntityDrawRegionId(null);
      setSelectedRegionIds([]);
      setSelectedEntityId(null);
      setTool("select");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    }
  }

  // --- Drawing completion / "Save annotations" (§5 step 6; gate
  // extended to require both completion phases in §2.3 step 14, slice 5) ---

  async function handleApprove() {
    if (!versionId) return;
    try {
      const updated = await approveAnnotationVersion(versionId);
      setVersion((prev) => (prev ? { ...prev, ...updated, regions: prev.regions, entities: prev.entities } : updated));
      flashSaved();
    } catch (err) {
      setError(describeError(err));
    }
  }

  // --- Version history (§5 step 7) ---

  async function handleStartNewVersion() {
    if (!versionId) return;
    setStartingVersion(true);
    try {
      const created = await startNewVersion(versionId);
      navigate(`/annotation-versions/${created.id}`);
    } catch (err) {
      setError(describeError(err));
      setStartingVersion(false);
    }
  }

  // Deleting any version is now one general flow (§4.3) -- this
  // subsumes the old, narrower "discard an abandoned draft fork" action:
  // discarding the current draft is just this same rule applied to that
  // one case, so it no longer needs its own separate handler.
  //
  // `otherVersionsCount` is passed in rather than read from the
  // `otherVersions` closure so the same function works for both the
  // header's "delete the version I'm viewing" button and each version
  // history row's "delete this other one" button, each of which knows a
  // different count of remaining siblings.
  function handleRequestDelete(id: string, otherVersionsCount: number) {
    if (id === version?.id && otherVersionsCount === 0) {
      // The serious, distinct confirmation (§4.3 point 3) -- deleting the
      // drawing's only version cascades into deleting the drawing itself.
      setLastVersionWarningOpen(true);
      return;
    }
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => setConfirmingDeleteId((cur) => (cur === id ? null : cur)), 4000);
      return;
    }
    void performDelete(id);
  }

  async function performDelete(id: string) {
    setConfirmingDeleteId(null);
    setLastVersionWarningOpen(false);
    setDeletingId(id);
    try {
      const result = await deleteAnnotationVersion(id);
      if (result.drawing_deleted) {
        clearStudio();
        navigate("/");
        return;
      }
      if (id === versionId) {
        // Deleted the version being viewed -- follow the promotion to
        // whichever version is now current rather than refreshing in place.
        navigate(`/annotation-versions/${result.new_current_version_id}`);
        return;
      }
      // Deleted a different, past version while still viewing this one --
      // just re-sync the sibling list (version history), nothing else
      // about the version being viewed changed.
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return <div className="page">Loading…</div>;
  if (error && !version) return <div className="page error-banner">{error}</div>;
  if (!version || !drawing) return <div className="page">Not found.</div>;

  const canTrace = TRACEABLE_FORMATS.has(drawing.format) && drawing.stored && !!contentUrl && !imageError && !contentError;
  const selectedEntity = entities.find((en) => en.id === selectedEntityId);
  const doneCount = regions.filter((r) => r.status === "done").length;
  const entitiesDoneCount = regions.filter((r) => r.entities_status === "done").length;
  // Gates "Proceed to entity annotation →" / the Entities tab itself --
  // region phase only (Layer 2). Deliberately NOT the same gate as Save
  // annotations below, or the Entities tab could never be reached at all.
  const canApprove = regions.length > 0 && doneCount === regions.length;
  // Gates "Save annotations" (§2.3 step 14, slice 5) -- both phases done:
  // every region's box (status) AND every region's entity annotation
  // (entities_status). Enforced server-side too (annotation_versions.py).
  const canSaveAnnotations = canApprove && entitiesDoneCount === regions.length;

  // §5 step 7: an approved version is read-only, period — editing means
  // forking a new version first, which can only happen from the drawing's
  // *current* version (never a past, already-superseded one).
  const canStartNewVersion = readOnly && version.is_current;
  const otherVersions = drawing.annotation_versions.filter((v) => v.id !== version.id).sort((a, b) => b.version_number - a.version_number);
  const supersededBy = version.superseded_by_id ? drawing.annotation_versions.find((v) => v.id === version.superseded_by_id) : undefined;

  return (
    <div className="page page--wide page--studio">
      <Link to="/" className="back-link">
        ← Back to Drawing Repository
      </Link>

      <div className="version-header">
        <div className="version-header__title-group">
          <h1 className="version-title">{drawing.original_filename}</h1>
          <div className="version-badges">
            <span className="badge badge--accent">{drawing.format.toUpperCase()}</span>
            <span className={`badge badge--status-${version.status}`}>{version.status}</span>
            <span className="hint">v{version.version_number}</span>
            {!version.is_current && <span className="badge">past version</span>}
          </div>
        </div>

        <div className="version-header__actions">
          {!readOnly && (
            <>
              {regions.length > 0 && (
                <span className="hint region-count-hint">
                  {doneCount}/{regions.length} regions · {entitiesDoneCount}/{regions.length} entities done
                </span>
              )}
              <button
                type="button"
                className="btn btn--ok btn--small"
                disabled={!canSaveAnnotations}
                title={
                  regions.length === 0
                    ? "Add at least one region first"
                    : !canApprove
                      ? "Mark every region done first"
                      : !canSaveAnnotations
                        ? "Finish entity annotation for every region first"
                        : undefined
                }
                onClick={handleApprove}
              >
                <IconCheck size={14} /> Save annotations
              </button>
            </>
          )}
          {canStartNewVersion && (
            <button type="button" className="btn btn--primary btn--small" disabled={startingVersion} onClick={handleStartNewVersion}>
              {startingVersion ? "Enabling editing…" : "Enable editing"}
            </button>
          )}
          {/* Deleting any version is allowed (§4.3) -- draft or approved,
              current or a past one being viewed read-only. */}
          <button
            type="button"
            className={"btn btn--small btn--danger" + (confirmingDeleteId === version.id ? " btn--confirm" : "")}
            disabled={deletingId === version.id}
            onClick={() => handleRequestDelete(version.id, otherVersions.length)}
            title={otherVersions.length === 0 ? "This is the drawing's only version -- deleting it deletes the whole drawing" : "Delete this version"}
          >
            <IconTrash size={13} /> {deletingId === version.id ? "Deleting…" : confirmingDeleteId === version.id ? "Confirm delete?" : "Delete version"}
          </button>
        </div>
      </div>

      {readOnly && (
        <p className="note-box note-box--info">
          {version.is_current
            ? "This version is approved and read-only. Click \"Enable editing\" to make changes."
            : supersededBy
              ? `This is a past version, superseded by version ${supersededBy.version_number}.`
              : "This is a past, approved version — read-only."}{" "}
          {!version.is_current && (
            <Link to={`/annotation-versions/${drawing.annotation_versions.find((v) => v.is_current)?.id ?? ""}`}>Go to the current version →</Link>
          )}
        </p>
      )}

      {error && <p className="error-banner">{error}</p>}
      {savedNote && <p className="note-box note-box--info">{savedNote}</p>}

      <div className="metadata-summary">
        <div className="metadata-summary__items">
          <span className="metadata-summary__item">
            <span className="hint">Standard</span>
            {version.standard ? version.standard.toUpperCase() : "—"}
          </span>
          <span className="metadata-summary__item">
            <span className="hint">Units</span>
            {version.units || "—"}
          </span>
          <span className="metadata-summary__item">
            <span className="hint">Discipline</span>
            {version.discipline || "—"}
          </span>
          <span className="metadata-summary__item">
            <span className="hint">Scale</span>
            {version.scale || "—"}
          </span>
          {version.standard === "iso" && (
            <span className="metadata-summary__item">
              <span className="hint">Tolerance grade</span>
              {version.general_tolerance_grade ? version.general_tolerance_grade.toUpperCase() : "—"}
            </span>
          )}
        </div>
        {!readOnly && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setMetadataModalOpen(true)}>
            <IconEdit size={13} /> Edit metadata
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor="sourceLink">Source link (Drive URL)</label>
        <input
          id="sourceLink"
          key={`source:${drawing.source_link ?? ""}`}
          className="input"
          placeholder="https://drive.google.com/…"
          defaultValue={drawing.source_link ?? ""}
          onBlur={(e) => saveSourceLink(e.target.value)}
        />
      </div>

      {metadataModalOpen && !readOnly && (
        <MetadataModal
          defaults={{
            standard: version.standard ?? metadataPrefill?.standard ?? null,
            units: version.units ?? metadataPrefill?.units ?? null,
            discipline: version.discipline ?? metadataPrefill?.discipline ?? null,
            scale: version.scale ?? metadataPrefill?.scale ?? null,
            general_tolerance_grade: version.general_tolerance_grade ?? metadataPrefill?.general_tolerance_grade ?? null,
          }}
          isForkedVersion={version.version_number > 1}
          saving={savingMetadata}
          error={metadataError}
          onSubmit={handleSaveMetadata}
        />
      )}

      {lastVersionWarningOpen && (
        <DeleteDrawingWarningModal
          filename={drawing.original_filename}
          deleting={deletingId === version.id}
          onCancel={() => setLastVersionWarningOpen(false)}
          onConfirm={() => performDelete(version.id)}
        />
      )}

      {!canTrace ? (
        !TRACEABLE_FORMATS.has(drawing.format) ? (
          <p className="note-box note-box--info">Tracing isn't available for .{drawing.format} files.</p>
        ) : !drawing.stored ? (
          <div className="note-box note-box--info note-box--column">
            <p>
              This drawing's preview has expired — cached files are only kept for 30 days. Re-upload the exact same
              file below to view and edit its annotations again; this won't create a new version.
            </p>
            {resumeError && <p className="error-banner">{resumeError}</p>}
            <UploadDropzone onFilesSelected={handleResumeUpload} disabled={resuming} />
            {resuming && <span className="hint">Checking the file matches…</span>}
          </div>
        ) : contentError ? (
          <p className="note-box note-box--info">This drawing's preview couldn't be loaded.</p>
        ) : (
          <p className="note-box note-box--info">Loading drawing preview…</p>
        )
      ) : (
        <>
          <div className="workspace-mobile-tabs">
            <button
              type="button"
              className={`workspace-mobile-tab ${mobileTab === "canvas" ? "workspace-mobile-tab--active" : ""}`}
              onClick={() => setMobileTab("canvas")}
            >
              <IconCanvas size={14} /> Canvas ({Math.round(zoomPct)}%)
            </button>
            <button
              type="button"
              className={`workspace-mobile-tab ${mobileTab === "annotations" ? "workspace-mobile-tab--active" : ""}`}
              onClick={() => setMobileTab("annotations")}
            >
              <IconLayers size={14} /> Annotations ({regions.length}/{entities.length})
            </button>
          </div>

          <div className="workspace-grid">
            <div className={`canvas-card ${mobileTab === "canvas" ? "mobile-tab--active" : "mobile-tab--hidden"}`}>
              <div className="toolbar canvas-toolbar">
                <div className="tool-group">
                  {TOOLS.filter((t) => {
                    if (readOnly) return t.id === "select" || t.id === "pan";
                    // Entities tab: region-drawing tools (Pen/Box) are only
                    // meaningful once a region is armed for entity drawing
                    // -- there's no such thing as freely drawing a region
                    // here (§2.3 step 10).
                    if (activeTab === "entities" && !entityDrawRegionId) return t.id === "select" || t.id === "pan" || t.id === "eraser";
                    return true;
                  }).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`tool-btn tool-btn--icon ${tool === t.id ? "active" : ""}`}
                      aria-label={`${t.label} (${t.shortcut})`}
                      onClick={() => setTool(t.id)}
                    >
                      {t.icon}
                      <span className="tool-tooltip">
                        <span className="tool-tooltip__name">{t.label}</span>
                        <kbd className="tool-tooltip__shortcut">{t.shortcut}</kbd>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="tool-group history-group">
                  <button
                    type="button"
                    className="tool-btn tool-btn--with-icon"
                    title="Undo (Cmd+Z / Ctrl+Z)"
                    disabled={readOnly || undoStack.length === 0}
                    onClick={handleUndo}
                  >
                    <IconUndo size={13} /> Undo
                  </button>
                  <button
                    type="button"
                    className="tool-btn tool-btn--with-icon"
                    title="Redo (Cmd+Shift+Z / Ctrl+Y)"
                    disabled={readOnly || redoStack.length === 0}
                    onClick={handleRedo}
                  >
                    <IconRedo size={13} /> Redo
                  </button>
                </div>
                <div className="spacer" />
                <div className="tool-group zoom-group">
                  <button type="button" className="tool-btn" title="Zoom out" onClick={() => setZoom(zoomPct / 1.25)}>−</button>
                  <span className="zoom-readout">{Math.round(zoomPct)}%</span>
                  <button type="button" className="tool-btn" title="Zoom in" onClick={() => setZoom(zoomPct * 1.25)}>+</button>
                  <button type="button" className="tool-btn" title="Fit to viewport" onClick={() => naturalSize && fitZoom(naturalSize)}>Fit</button>
                  <button type="button" className="tool-btn" title="Actual size (100%)" onClick={() => setZoom(100)}>1:1</button>
                </div>
              </div>
              {entityDrawRegionId && (
                <p className="tool-hint">
                  Draw a box for the new entity in this region — <button type="button" className="btn btn--ghost btn--small" onClick={() => setEntityDrawRegionId(null)}>cancel</button>
                </p>
              )}
              {!entityDrawRegionId && tool === "pen" && (
                <p className="tool-hint">
                  {readOnly
                    ? "This version is read-only."
                    : "Pen tool active · Hold Shift and click to form each point · Click near the first point to close the region"}
                </p>
              )}
              {!entityDrawRegionId && tool === "eraser" && (
                <p className="tool-hint">
                  {readOnly
                    ? "This version is read-only."
                    : "Eraser tool active · click any region or entity to delete it"}
                </p>
              )}
              {!entityDrawRegionId && tool === "select" && (
                <p className="tool-hint">
                  {readOnly
                    ? "Click a region or entity to view it. This version is read-only."
                    : activeTab === "entities"
                      ? "Click a faint region to start annotating the entities inside it."
                      : "Click to select · drag to move · drag edge/corner to resize · Cmd/Ctrl-click regions to select several · Esc clears · Delete removes"}
                </p>
              )}
              {infoNote && <p className="note-box note-box--info">{infoNote}</p>}

              <div className="tracer-wrap">
                {activeTab === "regions" && !readOnly && validSelectedRegionIds.length >= 2 && (
                  <div className="merge-bar" role="toolbar">
                    <span>{validSelectedRegionIds.length} regions selected</span>
                    <button type="button" className="btn btn--small btn--primary" onClick={handleMerge}>Merge</button>
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setSelectedRegionIds([])}>Cancel</button>
                  </div>
                )}
                <div
                  className="tracer-viewport"
                  ref={(el) => {
                    viewportRef.current = el;
                    setViewportEl(el);
                  }}
                >
                  <AnnotationTracerCanvas
                    imageUrl={contentUrl as string}
                    altText={drawing.original_filename}
                    format={drawing.format}
                    tool={tool}
                    readOnly={readOnly}
                    zoomPct={zoomPct}
                    regions={regions}
                    entities={entities}
                    regionsInteractive={activeTab === "regions"}
                    selectedRegionIds={activeTab === "regions" ? validSelectedRegionIds : entityDrawRegionId ? [entityDrawRegionId] : []}
                    selectedEntityId={selectedEntityId}
                    entityDrawRegionId={entityDrawRegionId}
                    viewportRef={viewportRef}
                    onNaturalSize={setNaturalSize}
                    onImageError={() => setImageError(true)}
                    onInfo={setInfoNote}
                    onCreateRegion={(pts) => {
                      handleCreateRegion(pts);
                    }}
                    onCreateEntity={(regId, bbox) => {
                      handleCreateEntity(regId, bbox);
                    }}
                    onSelectRegionOnly={(id) => {
                      selectRegionOnly(id);
                      const reg = id ? regions.find((r) => r.id === id) : undefined;
                      if (reg) zoomToShape(reg.points, 0.97);
                    }}
                    onToggleSelectRegion={toggleSelectRegion}
                    onSelectEntity={(id) => {
                      setSelectedEntityId(id);
                      if (id) {
                        setSelectedRegionIds([]);
                        const ent = entities.find((e) => e.id === id);
                        if (ent && ent.region_id) {
                          setEntityDrawRegionId(ent.region_id);
                          setActiveTab("entities");
                        }
                        if (ent) zoomToShape(ent.bbox);
                        requestAnimationFrame(() => {
                          const el = document.getElementById(`entity-item-${id}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        });
                      }
                    }}
                    onArmRegionForEntityDrawing={handleArmRegionForEntityDrawing}
                    onUpdateRegionPoints={handleUpdateRegionPoints}
                    onUpdateEntityBbox={handleUpdateEntityBbox}
                    onDeleteRegions={handleDeleteRegions}
                    onDeleteEntity={handleDeleteEntity}
                  />
                </div>
              </div>
            </div>

            <div className={`region-card ${mobileTab === "annotations" ? "mobile-tab--active" : "mobile-tab--hidden"}`}>
              <div className="workflow-tabs">
                <button
                  type="button"
                  className={`workflow-tab ${activeTab === "regions" ? "workflow-tab--active" : ""}`}
                  onClick={() => {
                    setActiveTab("regions");
                    setEntityDrawRegionId(null);
                    setSelectedEntityId(null);
                  }}
                >
                  <span className={`workflow-tab__num ${canApprove ? "workflow-tab__num--done" : ""}`}>
                    {canApprove ? <IconCheck size={11} /> : "1"}
                  </span>
                  <span>Regions</span>
                  <span className="workflow-tab__count">{doneCount}/{regions.length}</span>
                </button>
                <button
                  type="button"
                  className={`workflow-tab ${activeTab === "entities" ? "workflow-tab--active" : ""}`}
                  disabled={!canApprove}
                  title={!canApprove ? "Mark every region done first" : undefined}
                  onClick={() => {
                    setActiveTab("entities");
                    setSelectedRegionIds([]);
                  }}
                >
                  <span className={`workflow-tab__num ${canSaveAnnotations ? "workflow-tab__num--done" : ""}`}>
                    {canSaveAnnotations ? <IconCheck size={11} /> : "2"}
                  </span>
                  <span>Entities</span>
                  <span className="workflow-tab__count">{entitiesDoneCount}/{regions.length}</span>
                </button>
              </div>

              {activeTab === "regions" ? (
                <RegionsTab
                  regions={regions}
                  entities={entities}
                  readOnly={readOnly}
                  expandedRegionId={expandedRegionId}
                  selectedRegionIds={validSelectedRegionIds}
                  canProceed={canApprove}
                  onSelectRegion={(id) => {
                    setExpandedRegionId(id);
                    selectRegionOnly(id);
                    const reg = regions.find((r) => r.id === id);
                    if (reg) zoomToShape(reg.points, 0.97);
                  }}
                  onRegionChange={handleRegionChange}
                  onToggleDone={handleToggleRegionDone}
                  onDeleteRegion={(id) => handleDeleteRegions([id])}
                  onProceed={handleProceedToEntities}
                />
              ) : (
                <EntitiesTab
                  regions={regions}
                  entities={entities}
                  readOnly={readOnly}
                  entityDrawRegionId={entityDrawRegionId}
                  selectedEntity={selectedEntity}
                  onArmRegion={(id) => {
                    handleArmRegionForEntityDrawing(id);
                    setMobileTab("canvas");
                    const reg = regions.find((r) => r.id === id);
                    if (reg) zoomToShape(reg.points, 0.97);
                  }}
                  onCancelArm={() => setEntityDrawRegionId(null)}
                  onSelectEntity={(id) => {
                    setSelectedEntityId(id);
                    setSelectedRegionIds([]);
                    if (id) {
                      const ent = entities.find((e) => e.id === id);
                      if (ent) zoomToShape(ent.bbox);
                    }
                  }}
                  onDeleteEntity={handleDeleteEntity}
                  onEntityChange={handleEntityChange}
                  onMarkRegionEntitiesDone={handleMarkRegionEntitiesDone}
                  onConfirmClean={handleConfirmClean}
                />
              )}
            </div>
          </div>
        </>
      )}

      <VersionHistoryPanel
        current={version}
        others={otherVersions}
        confirmingDeleteId={confirmingDeleteId}
        deletingId={deletingId}
        onRequestDelete={(id) => handleRequestDelete(id, otherVersions.length)}
      />
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
