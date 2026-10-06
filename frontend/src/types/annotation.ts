/**
 * Types for Layer 2 (regions) and Layer 3 (entities) in the new
 * annotation-platform system — mirrors backend/app/schemas/region.py and
 * entity.py. Deliberately separate from types/file.ts, which mirrors the
 * old /files flow and its now-incompatible Region shape (level/category/
 * is_negative/is_ignore/human_verified/... from an earlier prototype).
 */

export type Point = [number, number];

export type RegionSource = "ai" | "human";
export type RegionStatus = "not_started" | "in_progress" | "done";

/** Shared across both the Regions tab and the Entities tab picker (§7.3:
 * "clear visual states... using color + icon, not just a text badge") --
 * one source of truth for how a status reads, paired with the
 * .badge--status-* colour already defined per value in global.css. */
export const REGION_STATUS_ICONS: Record<RegionStatus, string> = {
  not_started: "○",
  in_progress: "◐",
  done: "✓",
};

export const REGION_STATUS_LABELS: Record<RegionStatus, string> = {
  not_started: "not started",
  in_progress: "in progress",
  done: "done",
};

// IMPLEMENTATION_PLAN.md §5 step 4's exact list of Layer 2 zones.
export const REGION_TYPES = [
  "view",
  "section view",
  "detail view",
  "title block",
  "parts list",
  "dimension block",
  "notes",
  "revision table",
  "other",
] as const;

export interface Region {
  id: string;
  annotation_version_id: string;
  type: string;
  /** Text extraction state for this region: "running" while it's being read, "done", or "failed". */
  extraction_status?: string | null;
  extraction_note?: string | null;
  caption: string | null;
  notes: string | null;
  status: RegionStatus;
  /** Layer 3 completion for this region specifically -- separate from
   * `status` above, which only tracks the region box itself (Layer 2).
   * PHASE2_IMPLEMENTATION_PLAN.md §4.1, added in slice 2; first surfaced
   * in the UI in slice 4's Entities tab. */
  entities_status: RegionStatus;
  source: RegionSource;
  points: Point[];
  created_at: string;
  updated_at: string;
}

// --- Entity vocabulary: a kind (what sort of callout a box is) and an optional
// subtype (which specific kind of that callout). Mirrors
// backend/app/services/entity_taxonomy.py -- keep the two in step.

export const KIND_LABELS = {
  dimension: "Dimension",
  gdt: "GD&T frame",
  datum: "Datum",
  thread: "Thread",
  hole: "Hole callout",
  surface_finish: "Surface finish",
  weld: "Weld",
  fit: "Fit code",
  symbol: "Symbol",
  note: "Note / label",
  title_block: "Title block field",
  view_label: "View label",
  other: "Other",
} as const;

export type EntityKind = keyof typeof KIND_LABELS;
export const ENTITY_KINDS = Object.keys(KIND_LABELS) as EntityKind[];

export const SUBTYPE_LABELS: Record<EntityKind, Record<string, string>> = {
  dimension: {
    linear: "Linear",
    diameter: "Diameter ⌀",
    radius: "Radius R",
    angular: "Angular °",
    chamfer: "Chamfer",
    depth: "Depth",
    bolt_circle: "Bolt circle B.C.",
    spherical_diameter: "Spherical ⌀",
  },
  gdt: {
    position: "Position",
    flatness: "Flatness",
    straightness: "Straightness",
    circularity: "Circularity",
    cylindricity: "Cylindricity",
    perpendicularity: "Perpendicularity",
    parallelism: "Parallelism",
    angularity: "Angularity",
    profile_line: "Profile of a line",
    profile_surface: "Profile of a surface",
    concentricity: "Concentricity",
    symmetry: "Symmetry",
    circular_runout: "Circular runout",
    total_runout: "Total runout",
  },
  datum: { feature: "Datum feature", target: "Datum target" },
  thread: { metric: "Metric (M)", unified: "Unified (UNC/UNF)", pipe: "Pipe (NPT/BSP)" },
  hole: {
    thru: "Thru",
    tapped: "Tapped",
    counterbore: "Counterbore",
    countersink: "Countersink",
    spot_face: "Spot face",
    slip_fit: "Slip fit",
  },
  surface_finish: { ra: "Ra", rz: "Rz", symbol: "Finish symbol" },
  weld: { fillet: "Fillet", groove: "Groove", plug: "Plug", spot: "Spot", seam: "Seam" },
  fit: { hole: "Hole fit", shaft: "Shaft fit" },
  symbol: {
    counterbore: "Counterbore ⌴",
    countersink: "Countersink ⌵",
    depth: "Depth ↧",
    square: "Square □",
    centerline: "Centerline",
    break_line: "Break line",
    arrow: "Arrow / leader",
    other: "Other symbol",
  },
  note: {
    general: "General note",
    reference: "Note reference",
    qualifier: "Qualifier (TYP, Equally Spaced…)",
    material: "Material / process",
    label: "Feature label",
  },
  title_block: {
    drawing_number: "Drawing number",
    title: "Title",
    revision: "Revision",
    scale: "Scale",
    size: "Size",
    sheet: "Sheet",
    date: "Date",
    drawn_by: "Drawn by",
    checked_by: "Checked by",
    material: "Material",
  },
  view_label: { view: "View", section: "Section", detail: "Detail" },
  other: {},
};

/** "suggested" = proposed by text extraction, waiting for review;
 * "confirmed" = named by a person, or drawn by hand. */
export type EntityStatus = "suggested" | "confirmed";
/** Where the box came from. */
export type EntitySource = "manual" | "vector" | "ocr";

export interface Entity {
  id: string;
  annotation_version_id: string;
  region_id: string | null;
  kind: EntityKind;
  subtype: string | null;
  bbox: Point[];
  /** What's on the sheet, as the person confirmed it. The only field a person types. */
  text: string | null;
  /** What extraction read, before any correction. Kept for the dataset's audit trail. */
  raw_text: string | null;
  /** Read from `text` by the server: nominal value, tolerances, quantity, flags. Never typed by hand. */
  parsed: ParsedValues;
  /** Problems the parser found in `text` (e.g. a misread symbol). */
  warnings: string[];
  payload: Record<string, unknown>;
  status: EntityStatus;
  source: EntitySource;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedValues {
  value?: number;
  tolerance_plus?: number;
  tolerance_minus?: number;
  quantity?: number;
  thread?: string;
  fit_code?: string;
  is_diameter?: boolean;
  is_reference?: boolean;
  is_basic?: boolean;
}
