/**
 * The one place in the frontend that knows how to talk HTTP to the backend.
 * Every component calls these functions instead of calling `fetch` itself
 * — so if the API's base URL or error handling ever needs to change, it
 * changes here once.
 */

import type { TokenResponse, User } from "../types/auth";
import type {
  Entity as AnnotationEntity,
  Point as AnnotationPoint,
  Region as AnnotationRegion,
} from "../types/annotation";
import type {
  AnnotationVersion,
  AnnotationVersionDeleteResult,
  AnnotationVersionUpdate,
  DrawingOut,
  DrawingUpdate,
  DrawingUploadResult,
} from "../types/drawing";
import type { DatasetVersion, DatasetVersionExportResult, ExportPreview } from "../types/dataset";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8005/api";

// The signed-in person's access token lives in localStorage, so refreshing
// the page (or closing and reopening the tab) doesn't sign them out. It's
// per-browser only — never sent anywhere but this API, and never logged.
const TOKEN_KEY = "glypad_access_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage can be unavailable (private browsing, etc.) — the
       session just won't persist across a reload in that case */
  }
}

// Set by AuthProvider on mount so a 401 from any request (an expired or
// invalid token) can immediately clear the stale token and send the person
// back to the login page, instead of the app quietly failing.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// FastAPI error responses are JSON shaped like {"detail": "..."}. Pull the
// human-readable detail out when there is one, so the UI never has to show
// someone a raw JSON string with escaped quotes in it.
function extractErrorMessage(bodyText: string, fallback: string): string {
  if (!bodyText) return fallback;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.detail === "string") return parsed.detail;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return bodyText;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    if (response.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, extractErrorMessage(body, response.statusText));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function registerAccount(email: string, password: string, displayName: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
}

export function login(email: string, password: string): Promise<TokenResponse> {
  return request<TokenResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function getMe(): Promise<User> {
  return request<User>("/auth/me");
}

// --- Drawings (the new upload+dedup flow, IMPLEMENTATION_PLAN.md §5 steps 1-2) ---

export function uploadDrawing(file: globalThis.File): Promise<DrawingUploadResult> {
  const formData = new FormData();
  formData.append("upload", file);
  return request<DrawingUploadResult>("/drawings", { method: "POST", body: formData });
}

/** §5a's "preview expired — please re-upload" flow for this specific
 * drawing. Rejects with a 400 (surfaced via ApiError) if the uploaded
 * bytes don't actually match this drawing's content. */
export function resumeDrawing(id: string, file: globalThis.File): Promise<DrawingOut> {
  const formData = new FormData();
  formData.append("upload", file);
  return request<DrawingOut>(`/drawings/${id}/resume`, { method: "POST", body: formData });
}

export function listDrawings(): Promise<DrawingOut[]> {
  return request<DrawingOut[]>("/drawings");
}

export function getDrawing(id: string): Promise<DrawingOut> {
  return request<DrawingOut>(`/drawings/${id}`);
}

export function updateDrawing(id: string, patch: DrawingUpdate): Promise<DrawingOut> {
  return request<DrawingOut>(`/drawings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function getAnnotationVersion(id: string): Promise<AnnotationVersion> {
  return request<AnnotationVersion>(`/annotation-versions/${id}`);
}

export function updateAnnotationVersion(id: string, patch: AnnotationVersionUpdate): Promise<AnnotationVersion> {
  return request<AnnotationVersion>(`/annotation-versions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function approveAnnotationVersion(id: string): Promise<AnnotationVersion> {
  return request<AnnotationVersion>(`/annotation-versions/${id}/approve`, { method: "POST" });
}

/** Forks a new draft version off this one (which must be the drawing's
 * current, approved version) — §5 step 7, "Enable editing" in the UI.
 * As of PHASE2_IMPLEMENTATION_PLAN.md slice 6, copies every Layer 1
 * field, region, and entity forward as the new draft's editable
 * starting point -- it's not an empty draft. */
export function startNewVersion(id: string): Promise<AnnotationVersion> {
  return request<AnnotationVersion>(`/annotation-versions/${id}/start-new-version`, { method: "POST" });
}

// --- export screen (§5 step 8) ---

export function listDatasetVersions(): Promise<DatasetVersion[]> {
  return request<DatasetVersion[]>("/dataset-versions");
}

export function previewExport(): Promise<ExportPreview> {
  return request<ExportPreview>("/dataset-versions/preview");
}

export function createDatasetVersion(notes: string | null): Promise<DatasetVersionExportResult> {
  return request<DatasetVersionExportResult>("/dataset-versions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes }),
  });
}

/** Deletes any version -- draft or approved, current or a past one
 * (PHASE2_IMPLEMENTATION_PLAN.md §4.3). The result says whether the whole
 * drawing was deleted with it (only its own version) or, if siblings
 * remain, which version got promoted to current -- the caller uses this
 * to decide where to navigate rather than re-deriving the rule. */
export function deleteAnnotationVersion(id: string): Promise<AnnotationVersionDeleteResult> {
  return request<AnnotationVersionDeleteResult>(`/annotation-versions/${id}`, { method: "DELETE" });
}

function drawingContentUrl(id: string): string {
  return `${API_BASE_URL}/drawings/${id}/content`;
}

/** The content endpoint is behind auth, so it's fetched once with the
 * header and handed back as a Blob the caller turns into a local blob:
 * URL for the tracer to load from. */
export async function fetchDrawingContentBlob(id: string): Promise<Blob> {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(drawingContentUrl(id), { headers });
  if (!response.ok) {
    if (response.status === 401) {
      setToken(null);
      onUnauthorized?.();
    }
    const body = await response.text().catch(() => "");
    throw new ApiError(response.status, extractErrorMessage(body, response.statusText));
  }
  return response.blob();
}

// --- Layer 2 regions, scoped to an annotation version (not a file) ---

export function createRegionForVersion(
  versionId: string,
  region: { type: string; caption?: string | null; notes?: string | null; status?: string; points: AnnotationPoint[]; source?: "ai" | "human" },
): Promise<AnnotationRegion> {
  return request<AnnotationRegion>(`/annotation-versions/${versionId}/regions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(region),
  });
}

export function updateRegionForVersion(
  versionId: string,
  regionId: string,
  patch: Partial<Pick<AnnotationRegion, "type" | "caption" | "notes" | "status" | "entities_status" | "points">>,
): Promise<AnnotationRegion> {
  return request<AnnotationRegion>(`/annotation-versions/${versionId}/regions/${regionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function deleteRegionForVersion(versionId: string, regionId: string): Promise<void> {
  return request<void>(`/annotation-versions/${versionId}/regions/${regionId}`, { method: "DELETE" });
}

export function mergeRegionsForVersion(versionId: string, regionIds: string[]): Promise<AnnotationRegion> {
  return request<AnnotationRegion>(`/annotation-versions/${versionId}/regions/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region_ids: regionIds }),
  });
}

// --- Layer 3 entities ---

export function createEntity(
  versionId: string,
  entity: {
    kind: string;
    subtype?: string | null;
    text?: string | null;
    region_id?: string | null;
    bbox: AnnotationPoint[];
    status?: "suggested" | "confirmed";
  },
): Promise<AnnotationEntity> {
  return request<AnnotationEntity>(`/annotation-versions/${versionId}/entities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entity),
  });
}

export function updateEntity(
  versionId: string,
  entityId: string,
  patch: Partial<Pick<AnnotationEntity, "kind" | "subtype" | "region_id" | "bbox" | "text" | "status">>,
): Promise<AnnotationEntity> {
  return request<AnnotationEntity>(`/annotation-versions/${versionId}/entities/${entityId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export interface ExtractionRegionResult {
  region_id: string;
  method: "vector" | "ocr" | "none" | "manual_fallback";
  created: number;
}

export interface ExtractionResult {
  created: number;
  note: string | null;
  regions: ExtractionRegionResult[];
  /** True while the background job is still reading regions. */
  running: boolean;
}

/** "Proceed to entity annotation": reads the sheet's text and turns each
 * line inside a region into a suggested entity. Safe to call again -- each
 * region is only extracted once. */
export function extractEntitiesForVersion(versionId: string): Promise<ExtractionResult> {
  return request<ExtractionResult>(`/annotation-versions/${versionId}/extract-entities`, { method: "POST" });
}

/** Confirms every suggested callout in one region in a single request.
 * With skipWarnings (the default in the UI), callouts the parser flagged are
 * left for a person to check. */
export function confirmRegionSuggestions(
  versionId: string,
  regionId: string,
  skipWarnings = true,
): Promise<{ confirmed: number }> {
  return request<{ confirmed: number }>(`/annotation-versions/${versionId}/entities/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ region_id: regionId, skip_warnings: skipWarnings }),
  });
}

export function deleteEntity(versionId: string, entityId: string): Promise<void> {
  return request<void>(`/annotation-versions/${versionId}/entities/${entityId}`, { method: "DELETE" });
}
