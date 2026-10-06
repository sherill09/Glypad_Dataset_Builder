/**
 * Types for the export screen (IMPLEMENTATION_PLAN.md §5 step 8),
 * mirroring backend/app/schemas/dataset_version.py.
 */

export interface DatasetVersion {
  id: string;
  version_number: number;
  created_by_email: string | null;
  created_at: string;
  drawing_count: number;
  annotation_count: number;
  notes: string | null;
}

export interface ExportPreview {
  drawing_count: number;
  annotation_count: number;
}

export interface DatasetVersionExportResult {
  dataset_version: DatasetVersion;
  /** The COCO-style export content itself — deliberately untyped here,
   * same as the backend's response_model: it's handed straight to a Blob
   * for download, never inspected field-by-field by this page. */
  export: unknown;
}
