# Glypad Dataset Builder — Annotation Platform Implementation Plan

*Drafted from design discussion, early October 2026. All open decisions were confirmed on 2026-10-01 (see §9) — this document is final and ready to hand to Claude Code to build from, slice by slice, in the order given in §8.*

Covers the shift from the current general-purpose "upload/trace/classify" tool into a purpose-built annotation platform for training a layout + text + symbol extraction model for CAD drawing QC.

This plan assumes the reader (including Claude Code, building from this document) has access to the existing project — `~/projects/glypad-dataset-builder` — and its current `README.md` / `DEPLOYMENT.md`. It describes what changes, what stays, and in what order to build it.

---

## 1. What this phase is actually for

The existing app (auth, upload/classify, 2D tracer, 3D viewer, manifest table) was a general-purpose CAD file workspace. This phase turns it into something more specific: a tool for producing a **structured, versioned, training-ready annotation dataset** for CAD drawings, used to train a model that replaces the current VLM + native-text-extractor pipeline for layout and symbol extraction.

Everything below exists to serve one output: a periodically-exported, versioned JSON dataset that a training pipeline can consume.

---

## 2. Design decisions locked in by this discussion

These are the decisions already made and should not be re-litigated during the build — they're the foundation everything else sits on:

1. **Two storage layers, not one.** A live relational database (Postgres) holds working annotations. A separate, versioned JSON export is produced periodically for training — the database is never read directly by the training pipeline.
2. **The original drawing files are not kept as a permanent archive by this app.** The authoritative copy of a drawing lives wherever the team already keeps it (referred to as "the drive" in the original discussion). The app only needs the file bytes *while someone is actively viewing/annotating it* — not forever (working copy, 30-day TTL — see §7).
3. **A SHA-256 content hash is computed for every uploaded file**, and is the thing that establishes "is this the same drawing I've seen before" — not the filename, not where it's stored.
4. **Deduplication by hash**: uploading a file whose hash already exists shows the existing annotation(s) instead of starting blank.
5. **Full annotation version history is kept, never overwritten.** Editing an approved drawing's annotations creates a new version; the old one is marked superseded, not deleted. A new version is only ever created by an explicit action, never as a side effect of merely opening or viewing a drawing — see §5 step 7.
6. **Export is a manual, on-demand, whole-dataset action** — not something that happens per-drawing or automatically. It only includes annotation versions marked `approved`.
7. **Annotation happens in a fixed sequence per drawing**: drawing-level metadata → coarse layout regions → per-region structured entities → drawing-level approval. (Full walkthrough in §5.)
8. **Drive integration stays manual for this phase** (humans download from Drive and upload to the app by hand; no Drive API calls from the app). Confirmed for v1 — see §3 and §9 for the live-Drive-API phase planned *after* this app is confirmed working.

---

## 3. Drive integration — manual now, live API later (confirmed)

The original description was "people download the file, upload it to the application." Read literally, that's **always a manual, human-driven step on both ends** — nobody described the app reaching into Drive on its own, and this plan builds it that way for v1.

**v1 (this build): Drive handled entirely manually, by humans, outside the app.** Concretely:

- Uploading a file works exactly like it does today (drag-and-drop into the browser) — the human has already downloaded it from Drive themselves before this point.
- At upload time, add one optional text field: **"source link"** — the annotator pastes the Drive URL for the file they just uploaded. This is just a stored string, not a live connection; its only job is making sure that six months from now, someone looking at the export can find the original file again instead of hunting for it by filename.
- Exporting the dataset produces a downloadable JSON file through the browser, the same way any file download works today — a human then puts it wherever it needs to go (Drive, S3, anywhere), outside the app.

This keeps v1 unblocked by any new credential or Google Cloud setup — no service account, no OAuth client, nothing to go set up before Claude Code can start building.

**Phase 2 (confirmed, scheduled for after v1 is up and working): live Drive API integration.** Once this app is built, deployed, and confirmed working end-to-end with the manual flow above, come back and do live Drive integration as its own, separate, clearly-scoped piece of work: a Google Cloud project, Drive API enabled, a service account or OAuth client, and then wiring the app to fetch files from a Drive folder directly and/or write exports back into one automatically. This is **not** part of the v1 build order in §8 — it's explicitly deferred until after v1 ships, and should be scoped as its own follow-up plan when that time comes (it will touch the `source_link` field's shape and add a new settings/credentials surface, so it's its own slice of work, not a bolt-on).

---

## 4. Data model changes

This is the biggest structural change. The current schema (`files` → `regions` directly) doesn't have a concept of "the same drawing annotated more than once," so it needs to grow into something with a stable drawing identity and a version history hanging off it. **Since there's no real production data yet, this is a breaking schema change — the current dev database can simply be reset, not migrated.**

### New table: `drawings`
One row per *unique file content*, identified by hash — not per upload.

| Column | Purpose |
|---|---|
| `id` | primary key |
| `content_hash` | SHA-256 of the file bytes, unique, indexed — this is the dedup key |
| `original_filename` | filename as first seen, informational only |
| `source_link` | the Drive URL the uploader pasted in (optional) |
| `category` / `format` / `complexity` | carried over from the existing classification logic, computed once at first upload |
| `first_uploaded_by_id`, `created_at` | audit trail |

### New table: `annotation_versions`
One row per annotation attempt on a drawing. This is the thing that gets edited, approved, and superseded. **Rows here are only ever created by an explicit action** (the first-ever version on upload, step 2 in §5; or an explicit "Start new version" click on an approved drawing, step 7 in §5) — never implicitly just because someone opened a drawing to look at it.

| Column | Purpose |
|---|---|
| `id` | primary key |
| `drawing_id` | FK → `drawings` |
| `version_number` | 1, 2, 3... sequential per drawing |
| `status` | `draft` \| `approved` (same two states as today, just moved here) |
| `is_current` | true for exactly one version per drawing — the latest |
| `standard` | `iso` \| `asme` \| null — captured in the Layer-1 metadata step |
| `units`, `discipline`, `scale` | rest of the Layer-1 metadata |
| `created_by_id`, `created_at` | who started this version |
| `approved_by_id`, `approved_at` | who approved it, and when |
| `superseded_by_id` | nullable FK to the version that replaced this one |

### Changed table: `regions` (existing — Layer 2, coarse layout)
Mostly unchanged in shape, but re-pointed and extended:
- `file_id` → replaced with `annotation_version_id` (each version gets its own full set of regions — this is what makes history actually work)
- **add** `status`: `not_started` \| `in_progress` \| `done` — your per-region completion tracking idea

### New table: `entities` (Layer 3 — the new, structured-annotation layer)
This is the table that doesn't exist yet and carries most of the new value — dimensions, GD&T frames, fit codes, surface finish, thread designations, weld symbols, datum symbols, title-block fields. **Category list confirmed as-is for v1 — no additions or cuts**: `dimension`, `gdt_frame`, `fit_code`, `surface_finish`, `thread`, `weld_symbol`, `datum_symbol`, `title_block_field`, `other`.

| Column | Purpose |
|---|---|
| `id` | primary key |
| `annotation_version_id` | FK → `annotation_versions` |
| `region_id` | FK → `regions`, nullable — which coarse region this sits inside |
| `category` | `dimension` \| `gdt_frame` \| `fit_code` \| `surface_finish` \| `thread` \| `weld_symbol` \| `datum_symbol` \| `title_block_field` \| `other` |
| `bbox` | the bounding box, same point-array shape as `regions.points` today |
| `payload` | a single JSON column holding whatever structured fields that category needs |
| `created_by_id`, `created_at` | audit trail |

The `payload` column is deliberately flexible rather than one database column per possible field (this is the same principle COCO itself uses for its `categories` list) — a `dimension` payload looks like `{"value": 42.5, "tolerance": 0.1, "unit": "mm"}`; a `gdt_frame` payload looks like `{"symbol": "position", "tolerance_value": 0.1, "modifier": "MMC", "datum_refs": ["A","B"]}`. Adding a brand-new category later (say, Tier 2's welding symbols) means adding a name to a list and deciding its payload shape in application code — not a database migration.

### New table: `dataset_versions`
Tracks each export, metadata-only — never holds the actual exported content.

| Column | Purpose |
|---|---|
| `id`, `version_number` | identity |
| `created_by_id`, `created_at` | who triggered it, when |
| `drawing_count`, `annotation_count` | what it covers, for a quick glance |
| `notes` | free text, e.g. "pre-v2-training-run export" |

### Not changed: `users`
No changes needed here — individual accounts, auth, and ownership tracking all carry over as-is.

---

## 5. The annotation workflow, step by step (what the UI needs to support)

This is the sequence agreed on, translated into concrete screens/actions:

1. **Upload.** Same drag-and-drop as today. On upload: compute the file's SHA-256 hash immediately.
2. **Dedup check.** Look up the hash in `drawings`. If it already exists: show the person the existing annotation version(s) ("this drawing was already annotated by X on [date] — view it, or start a new version?") instead of silently starting fresh. If it's new: create a `drawings` row and a first `annotation_versions` row (`version_number = 1`, `status = draft`).
3. **Layer 1 — drawing-level metadata.** A short form, filled in before any boxes are drawn: tolerancing standard (ISO/ASME), units, discipline, scale. Saved onto the `annotation_versions` row immediately.
4. **Layer 2 — coarse regions.** The existing tracer (Box/Pen/Select tools, unchanged) is used to mark the big zones: title block, each view, section/detail views, dimension block, parts list, notes, revision table. Each region can be marked `in_progress` / `done` as the per-region status.
5. **Layer 3 — structured entities, per region.** Select a region already marked out in step 4, zoom into it, and annotate the individual entities inside it (dimensions, GD&T frames, fit codes, surface finish symbols, thread designations, weld symbols, datum symbols) — each saved as its own `entities` row the moment it's created, same as regions are today. Title-block fields get transcribed the same way, tagged by field type (drawing number, material, revision, etc.).
6. **Mark the drawing complete.** Once every region is `done`, the existing Approve action applies — sets `annotation_versions.status = approved`, stamps `approved_by_id`/`approved_at`.
7. **Later edits — opening an approved drawing does NOT fork it.** Opening an `approved` drawing shows its current version read-only by default — safe to click into just to look, with no side effect. Forking only happens through a visible, explicit **"Start new version"** action on that screen. Clicking it is what actually creates the new `annotation_versions` row (`version_number + 1`, `status = draft`), copying nothing automatically (the person re-does/adjusts what needs changing); only once that new version is itself saved/approved does the old version's `superseded_by_id` get stamped. If someone clicks "Start new version" and then navigates away without saving anything, that empty draft version is harmless to leave behind, but the UI should make it easy to resume or discard it rather than silently accumulating empty drafts — a "discard this draft" affordance, built alongside this slice. The old version's data is never deleted regardless.
8. **Export (separate screen, not per-drawing).** A person triggers "Create dataset version." The app selects every drawing's *current, approved* annotation version, builds the COCO-style JSON (structure already sketched in the earlier discussion — `image` block with `source_link`/`content_hash`, `annotations` array with category + bbox + payload), and offers it as a file download. A new `dataset_versions` row records the snapshot's metadata.

### 5a. Reopening a drawing later — the 30-day working-file window

This came up as a follow-up question and is worth spelling out explicitly, since it's easy to conflate "the file's bytes expired from working storage" with "the annotation data is at risk" — it isn't.

- **The annotation data (the `drawings` row, every `annotation_versions` row, every `region` and `entity`) is never tied to the working-storage file's TTL.** It lives in Postgres and sits there regardless of whether the file bytes are still cached.
- **What the TTL actually gates is the *visual* preview** — rendering the drawing image with regions/entities drawn on top of it. That needs the actual pixels, and those are what gets evicted after the TTL.
- **The TTL is confirmed at a flat 30 days** from upload (not 24 hours of inactivity — a simple fixed 30-day expiry on the cached file, see §7).
- **Inside the 30-day window:** clicking into a drawing works exactly as it does today — the cached file is still there, so the preview renders with annotations overlaid immediately. No different behavior, nothing to build here.
- **Past the 30-day window:** the app should not silently fail or show a blank page. The right behavior is a clear state — "this drawing's preview has expired — please re-upload the file to view and edit its annotations" — with an upload prompt right there. The person re-uploads their own Drive copy, the app hashes it, matches the hash against the `content_hash` already stored on that `drawings` row, confirms it's the same file, and renders the preview with the existing annotations on top again. **This is the exact same hash-matching mechanism from the dedup flow in step 2 above, just triggered for "resume viewing" instead of "is this a new upload"** — nothing new to build conceptually, just reusing the same check from a second entry point.
- **Possible UI nicety (not required for v1):** the annotation *data* itself — the list of dimension values, GD&T entries, title-block fields, etc. as a plain table — could be shown without needing the image at all, since that's just reading rows out of Postgres. Only the visual, boxes-on-the-drawing view needs the re-upload. Not required for v1; worth deciding later whether it's useful enough to build.
- **Reminder:** this re-upload flow is purely about getting the *preview pixels* back — it is unrelated to the versioning question in §5 step 7. Re-uploading to restore the preview never creates a new `annotation_versions` row by itself; it just re-attaches the cached file to whatever version is already current.

---

## 6. What stays exactly as it is

Worth being explicit about this, since Claude Code building from this document should *not* touch these:

- Authentication (individual accounts, JWT, bcrypt) — no changes.
- The tracer's drawing mechanics (Pen/Box/Select tools, pan/zoom, coordinate math) — reused as-is for both Layer 2 and Layer 3 annotation; it's a drawing tool, it doesn't care what the boxes mean.
- PDF/DXF/STL/OBJ viewers — unchanged; still how the file gets rendered for annotation.
- File classification logic (2D/3D, vector/raster, text-layer detection) — still runs on upload, still useful.
- The AI-suggest (Gemini) feature — still valuable, and arguably *more* valuable now: it's the natural engine for proposing Layer 3 entities (dimensions, GD&T frames) for a human to correct, not just Layer 2 regions. Worth extending its prompt to also propose entities once Layer 3 exists, as a later slice — not blocking the initial build.
- Deployment setup (Docker, `docker-compose.prod.yml`, `DEPLOYMENT.md`) — no changes needed for this phase.

## 7. What's removed or changes meaningfully

- **The `StorageBackend` abstraction (local/S3) stops being "permanent archive" and becomes "working cache."** Keep the existing interface (it's already swappable local/S3), but change its *retention policy*: a file only needs to stay in storage while someone has it open for the current annotation session. **TTL confirmed: a flat 30 days from upload** — a cached file is deleted 30 days after it was uploaded (or re-uploaded), regardless of activity in between. A simple scheduled cleanup job (e.g. a daily task that deletes any cached file older than 30 days) is enough — no need for anything more elaborate like an activity-based/sliding TTL. Re-opening the drawing after the 30 days have passed just means the person re-uploads it (manually, from their own Drive copy), which triggers the same hash-match/resume flow described in §5a — the annotation data was never at risk, only the convenience of not having to re-upload.
- **`files` and `regions` as they exist today get restructured** into `drawings` / `annotation_versions` / `regions` / `entities`, per §4. This is a breaking schema change — acceptable, since no real production data exists yet to migrate.
- **Versioning is now explicit, not implicit.** The old app had only `draft`/`approved` on a file directly. Now, forking a new version off an approved drawing requires a deliberate "Start new version" click (§5 step 7) — opening or viewing an approved drawing is always safe and never mutates anything.

---

## 8. Build order — incremental slices

Each slice should be independently buildable and testable, same discipline as the earlier phases of this project. None of these are blocked on new credentials — the manual-Drive approach (§3) means v1 needs no new API keys or cloud setup beyond what the app already has (Gemini, S3 are both already optional/existing).

1. **Data model migration.** New tables (`drawings`, `annotation_versions`, `entities`, `dataset_versions`), `regions` repointed, `files`/old direct relationship retired. Backend only, verified via direct DB queries and API tests — no UI changes yet.
2. **Hash + dedup on upload.** Compute SHA-256 on upload, create/find the `drawings` row, detect existing versions, surface "already annotated — view or start new version?" in the UI.
3. **Layer 1 metadata step.** The drawing-level form (standard/units/discipline/scale), wired to a new `annotation_versions` row.
4. **Layer 3 entity annotation.** The confirmed category list (dimension, GD&T frame, fit code, surface finish, thread, weld symbol, datum symbol, title-block field, other) and their payload shapes, new UI affordance in the tracer for creating/editing entities within a selected region, API endpoints for `entities` CRUD.
5. **Per-region status + drawing completion.** The `in_progress`/`done` region flags, and reusing the existing Approve flow against `annotation_versions`.
6. **Version history UX.** A read-only view of an approved drawing by default, the explicit "Start new version" action described in §5 step 7, a "view past versions" list, and a "discard this draft" affordance for an unsaved forked version.
7. **Export screen.** The dataset-version trigger, COCO-JSON builder, file download, `dataset_versions` record.
8. **30-day working-file TTL + expired-preview re-upload flow.** The scheduled cleanup job that deletes cached files 30 days after upload, and the "preview expired — re-upload to view" state described in §5a, reusing the dedup hash-match endpoint from slice 2. Can land any time after slice 2 is done; not a hard dependency for slices 3–7.
9. *(Stretch, not required for a working v1)* **Relationships between entities** — linking a GD&T frame to its datum symbols, a BOM row to its balloon.

**Explicitly out of scope for this build** (deferred to Phase 2, per §3): live Drive API integration (auto-fetch from / auto-write to Drive). Do not build this now — the manual upload + "source link" field flow is final for v1.

---

## 9. Decisions — confirmed 2026-10-01

All three open items from the design discussion are now settled:

1. **Drive integration:** stays manual for this build (§3). Live Drive API integration is a confirmed *future* phase, to be scoped and built only after this app is built and confirmed working end-to-end — not part of this build order.
2. **Layer 3 category list (§4):** kept exactly as originally proposed — no additions or cuts for v1.
3. **Working-file TTL (§7):** a flat **30 days** from upload. After 30 days, the cached file is deleted and reopening that drawing shows the "preview expired — re-upload to view" state (§5a), which re-uses the dedup hash-match check rather than needing anything new.

This document is final for v1. Hand it to Claude Code as-is — it has enough to build from directly, slice by slice, in the order in §8.
