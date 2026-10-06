/**
 * Types for the new annotation-platform upload+dedup flow
 * (IMPLEMENTATION_PLAN.md §5 steps 1-2), mirroring
 * backend/app/schemas/drawing.py. Kept separate from types/file.ts, which
 * mirrors the old /files flow — the two are intentionally parallel systems
 * during this rebuild (see README), not meant to be merged yet.
 */

import type { Entity, Region } from "./annotation";

export type AnnotationVersionStatus = "draft" | "approved";

export interface AnnotationVersionSummary {
  id: string;
  version_number: number;
  status: AnnotationVersionStatus;
  is_current: boolean;
  created_by_email: string | null;
  created_at: string;
  approved_at: string | null;
  superseded_by_id: string | null;
}

export interface DrawingOut {
  id: string;
  content_hash: string;
  original_filename: string;
  source_link: string | null;
  category: "2d" | "3d";
  format: string;
  complexity: "simple" | "medium" | "complex";
  page_count: number;
  has_vector_geo: boolean;
  has_raster_geo: boolean;
  has_vector_text: boolean;
  has_raster_text: boolean;
  stored: boolean;
  storage_note: string | null;
  first_uploaded_by_email: string | null;
  created_at: string;
  version_count?: number;
  annotation_versions: AnnotationVersionSummary[];
}

export interface DrawingUploadResult {
  /** true: a brand-new drawing (+ its first annotation version) was just
   * created. false: this exact content hash already existed — see
   * `drawing.annotation_versions` for what's already there. */
  created: boolean;
  drawing: DrawingOut;
}

export type AnnotationStandard = "iso" | "asme";

/** ISO 2768's general tolerance grade — only meaningful when `standard`
 * is "iso" (PHASE2_IMPLEMENTATION_PLAN.md §3.4). */
export type GeneralToleranceGrade = "f" | "m" | "c" | "v";

/** The full annotation version — everything AnnotationVersionSummary has,
 * plus the Layer 1 metadata fields (§5 step 3, extended in Phase 2 §3.4)
 * and its Layer 2/3 content. */
export interface AnnotationVersion extends AnnotationVersionSummary {
  drawing_id: string;
  standard: AnnotationStandard | null;
  units: string | null;
  discipline: string | null;
  scale: string | null;
  general_tolerance_grade: GeneralToleranceGrade | null;
  approved_by_email: string | null;
  superseded_by_id: string | null;
  regions: Region[];
  entities: Entity[];
}

export interface AnnotationVersionUpdate {
  standard?: AnnotationStandard | null;
  units?: string | null;
  discipline?: string | null;
  scale?: string | null;
  general_tolerance_grade?: GeneralToleranceGrade | null;
}

export interface DrawingUpdate {
  source_link?: string | null;
}

/** What DELETE /annotation-versions/{id} returns
 * (PHASE2_IMPLEMENTATION_PLAN.md §4.3, §5) -- enough for the frontend to
 * know where to navigate next without re-deriving the promotion/cascade
 * rule itself. */
export interface AnnotationVersionDeleteResult {
  drawing_deleted: boolean;
  drawing_id: string;
  new_current_version_id: string | null;
}
