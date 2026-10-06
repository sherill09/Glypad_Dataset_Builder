# Glypad Dataset Builder — Phase 2: Guided Annotation Flow, Visual Redesign & Cleanup

*All open items were confirmed on 2026-10-04 (see §9) — this document is final and ready to hand to Claude Code, built slice by slice per §8. Supersedes nothing in `IMPLEMENTATION_PLAN.md` (that plan's slices 1–8 are done and stay as the historical record of how the current schema/API came to exist); this is a new, separate plan for the next phase: redesigning the UI around the exact guided flow described below, teaching the entity schema a bit more CAD, and deleting what's left over from before the Phase-1 rebuild.*

---

## 0. First, a few things found while scoping this — status as of confirmation

Checking the actual project folder turned up two things, both now resolved:

1. **A stuck git process** (`.git/index.lock`, a stray `.gitignore.tmp`) — left behind by the separate Claude Code terminal session. **Resolved**: that session's work is done; the lock should simply be cleared (delete `.git/index.lock` by hand if it's still sitting there) before this phase's cleanup commits start, so they land on a clean, known state.
2. **Uncommitted frontend changes** (the in-progress swap from the old `TracerCanvas`/`RegionPanel` pair to the new `AnnotationTracerCanvas` component) — **confirmed done**. This plan treats the current working tree as the real baseline; if anything about that in-progress work turns out to need altering once this phase's slices touch the same files, it's fair game to change.

---

## 1. What already exists (confirmed by reading the actual code, not assumed)

Phase 1 (the plan in `IMPLEMENTATION_PLAN.md`) is genuinely done — all 8 slices are committed. Concretely, right now:

- **Schema**: `drawings` → `annotation_versions` → `regions` (Layer 2) + `entities` (Layer 3, each tagged with one of the 9 confirmed categories and a flexible `payload` JSON field) exactly as designed. `annotation_versions` already has `is_current`, `superseded_by_id`, a DB-enforced "exactly one current version per drawing" constraint, and `status: draft|approved`.
- **API**: full CRUD for drawings/annotation-versions/regions/entities, `POST /annotation-versions/{id}/approve`, `POST /annotation-versions/{id}/start-new-version`, `DELETE /annotation-versions/{id}` (currently scoped to deleting a draft fork and reverting to the version it came from — this phase replaces that behavior per §4.3), AI-suggest for regions (already correctly pointed at `annotation_version_id`, not legacy), and the 30-day TTL + re-upload-to-resume flow.
- **Frontend**: `/drawings` (upload + dedup) → `/annotation-versions/:id` (the single workspace page — Layer 1 metadata, Layer 2 regions, Layer 3 entities, approve, start-new-version, version history, all on one page, not yet split into the two-phase flow this document describes) → `/export`.
- **Theming**: the whole app already uses CSS custom properties consistently (`var(--surface)`, `var(--border)`, `var(--accent)`, `var(--radius-lg)`, etc.) — but only one palette is defined, hardcoded to dark (`color-scheme: dark` in `global.css`). This is good news for §7: adding light mode is "define a second palette and a toggle," not a rewrite.
- **Legacy, confirmed dead-but-still-wired**: a parallel `files` subsystem — `app/models/file.py`, `app/schemas/file.py`, `app/api/routes/files.py`, `FileLibraryPage.tsx`, `FileWorkspacePage.tsx`, `FileListItem.tsx` — is still the app's literal home page (`/`) and still fully mounted. The code's own comments confirm this directly: `FileWorkspacePage.tsx` says outright *"This used to be a full region-tracing workspace... all of that called /files/{id}/regions... which no longer exist on the backend at all... this page is now view-only."* `DrawingsUploadPage.tsx` says *"intentionally a small, standalone page, separate from the existing file library/workspace (still at '/', still backed by the old /files endpoints, still working on its own)."* This is exactly the "old leftovers" you flagged, and §6 below is the specific, grounded deletion list.

---

## 2. The target flow, confirmed

### 2.1 Upload → viewer appears → metadata modal

1. Person opens the hosted link, uploads a file (drag-drop, same as today).
2. The viewer for that sheet renders immediately underneath.
3. **A modal appears on top of it** asking for Layer 1 metadata: tolerancing standard (ISO/ASME), units, discipline, scale, **plus the new general tolerance grade field (f/m/c/v, shown only when standard = ISO) — see §3.4**. This replaces today's always-visible inline form at the top of the page with an actual blocking modal.
4. Submitting the modal saves it to the `annotation_versions` row (same API call as today, `PATCH .../annotation-versions/{id}`) and the modal closes. The person can now draw.
5. **Confirmed**: on a second-or-later version (opened via "Enable editing," §2.5), the modal is pre-filled with the previous version's values — consistent with the copy-forward behavior now confirmed for the whole fork (§2.5 step 18). Still shown and still must be explicitly submitted, just not blank.

### 2.2 Tab 1 — Regions (Layer 2)

6. The person draws a bounding box on the viewer (Box tool, already exists). As soon as a box is drawn, a small panel opens for that region: type (the existing 9 options: view, section view, detail view, title block, parts list, dimension block, notes, revision table, other), caption, notes.
7. A **Done checkbox** in that panel. Checking it: (a) saves the region's fields, (b) sets that region's status to `done`, (c) closes/collapses that region's panel.
   - **Confirmed**: regions keep saving to the database continuously as they're drawn and edited — exactly like today — rather than being held only in the browser until "Proceed to entity annotation." The Done checkbox works exactly as described from the person's point of view; "saved" is just happening underneath the whole time, not only at that click. This is the safer option (a crash or refresh mid-session loses at most one in-progress box, not the whole batch) and is the one going into the build.
8. Repeat for every region on the sheet.
9. A **"Proceed to entity annotation →"** button, top-right, enabled once every region drawn so far has status `done` (mirrors the exact gating pattern the current Approve button already uses — `regions.length > 0 && doneCount === regions.length`). Clicking it switches to Tab 2 — a pure phase transition; nothing new is persisted at this click, since it already was (per the point above).

### 2.3 Tab 2 — Entities (Layer 3)

10. Same viewer, same sheet. The regions from Tab 1 are drawn in a light/faint border color — visible as a map of where things are, not editable as regions anymore (no resizing, no new region boxes).
11. Clicking a region selects it and enters **entity-annotation mode for that region only**. Drawing a box inside it creates an entity; a panel opens asking for category (the 9 confirmed types) and that category's specific fields.
12. The person repeats this for every entity inside that region.
13. Once every entity inside that region is captured, a single **"Done" button at the region level** (not per-entity) marks that region's *entity phase* complete and returns the person to the region list to pick the next one.
   - Needs one schema addition: `regions.entities_status` (`not_started | in_progress | done`), tracking the Layer-3 completion state separately from the existing Layer-2 `status` column. See §4.1.
14. Once every region's `entities_status` is `done`, the final **"Save annotations"** button (= today's Approve, relabeled) becomes enabled. Clicking it sets the version to `approved`, stamps `approved_by`/`approved_at` — gated on both region completion *and* entity completion.

### 2.4 File-library status

15. Back in the drawing list, status shows `annotated` once a version is approved (today's list already shows `status` — this is a labeling/display change, not new plumbing, once the legacy `files`-table status column is retired per §6).

### 2.5 Reopening, editing, versioning

16. Clicking an already-annotated drawing opens it **read-only by default** — already exists today (`readOnly = version.status === "approved"`).
17. An explicit **"Enable editing"** action is what makes changes possible — functionally today's "Start new version," renamed to the clearer, less CAD-jargon-y label. Forking remains the only way anything changes, and it's still only ever triggered by this explicit click.
18. **Confirmed — supersedes the original Phase-1 decision**: "Enable editing" copies everything from the previous version forward — every region, every entity, every Layer 1 field — as the new draft's editable starting point. (The original Phase-1 decision was "fork copies nothing, re-trace from scratch"; this plan replaces that with full copy-forward, since it fits "I'm fixing three dimensions on an otherwise-correct drawing" far better than re-tracing 40 regions.)
19. Saving that edited draft creates it as `v2` (already exactly how the system works — `version_number + 1`, old version gets `superseded_by_id`, nothing deleted). Both versions show up in the version history list.
20. **Deleting a version** — new capability. See §4.3 for the exact rule, including what happens when the version being deleted is the only one a drawing has.

---

## 3. CAD/GD&T knowledge — what these entity categories are, why they matter for a QC model, and the confirmed field additions

You said plainly you're not a CAD person — this section is that briefing, scoped to exactly the 9 entity categories already in the schema (confirmed as-is, no additions/cuts per the Phase-1 decision — everything below is new *fields within* each category, not new categories). This ties directly to the standards knowledge base already in this project (`standards-knowledge-base-discussion.md`), since the whole point of this dataset is training a model to do the drawing-QC checks described there.

### 3.1 Why structured entities at all, not just "read the text"

A mechanical drawing's dimensions, tolerances, and symbols aren't prose — they're a notation system where the *shape* of the mark (a diameter symbol vs. a radius symbol, a boxed "basic" dimension vs. an ordinary one, a feature control frame vs. a plain note) changes what it legally means. A model trained only on "here's a region, here's some text in it" never learns that distinction. Tagging *category + structured fields* per entity is what lets a future QC model actually reason like "this is a dimension, it has no explicit tolerance, so ISO 2768's general-tolerance grade applies" — which is the exact kind of check the standards KB describes.

### 3.2 The 9 categories, what each one is, and the standard behind it

| Category | What it actually is on a drawing | Standard it maps to (per this project's KB) | Why a QC model needs it tagged separately |
|---|---|---|---|
| `dimension` | A measured size with an arrow/leader — "42.5 ±0.1", a diameter, a radius, an angle | ISO 129-1 (how it's legally written) | The most common thing on any drawing; everything else (fits, GD&T, general tolerances) hangs off correctly identifying these first |
| `gdt_frame` | A feature control frame — the little boxed symbol sequence (⟟, ⌖, ⊥, etc.) with a tolerance value and datum letters | ISO 1101, 5459, 14405, 8015 | Highest-value, hardest category to get right — this is literally what "GD&T" means, and it's where most real manufacturing ambiguity lives |
| `fit_code` | A designation like "H7/g6" describing how tightly two mating parts fit together | ISO 286-1/-2 | Only meaningful as a *code* — "H7" isn't a tolerance value, it's a lookup key into a table, so it must stay tagged as its own thing rather than folded into a generic dimension |
| `surface_finish` | A roughness symbol/value, e.g. "Ra 3.2" | ISO 21920 (replaced ISO 1302/4287) | Your own KB doc flags this as a *confirmed real gap today* — these values get mistagged as plain dimensions. Keeping it its own category is what fixes that at the data level |
| `thread` | A thread callout, e.g. "M8×1.25" | ISO 68, 261, 262, 965 | Currently unsupported by the decision engine (per the KB doc) — this dataset is what would eventually teach a model to recognize these instead of escalating every one |
| `weld_symbol` | The welding symbol (fillet/groove/plug/etc.), often with a reference line and side indicator | ISO 2553, 5817, 13920 | ISO 13920 is a named gap in your own KB — same story as thread callouts |
| `datum_symbol` | A lettered box (A, B, C...) marking a reference surface/feature that GD&T frames point back to | ISO 5459 | Datums only mean anything in relation to the GD&T frames that reference them — this is why `gdt_frame`'s `datum_refs` field (already exists) links back to these by label |
| `title_block_field` | A transcribed field from the title block — drawing number, material, revision, scale, date, author | ISO 7200, 5457 | Low-glamour but necessary — this is the metadata that makes an exported dataset traceable back to a real drawing |
| `other` | Anything that's clearly an annotation but doesn't fit the above 8 | — | The deliberate escape valve — matches the KB's own "never silently drop something, escalate instead" principle |

### 3.3 Confirmed field additions

All confirmed — these are additive fields on the existing `payload` JSON for each category, same pattern as everything already there. No new categories, no breaking changes.

- **`dimension`**: add `is_basic` (checkbox — a dimension drawn inside a box, meaning it's exempt from tolerance, used as a GD&T reference size), `is_reference` (checkbox — a dimension in parentheses, for information only, not toleranced), and `dimension_type` (select: linear / diameter / radius / angular / chamfer — the symbol in front of the number, ⌀/R/°, already visually distinguishes these, and the tolerance rules that apply differ by type).
- **`gdt_frame`**: no new field, but the `datum_refs` input gets a placeholder/helper note clarifying that entry order is precedence order (primary datum first) — that's already true of how GD&T frames are read, just not obvious from the field alone today.
- **`thread`**: add `thread_form` (select: external / internal — bolt/screw thread vs. a tapped hole) and `handedness` (select: right / left, defaulting to right).
- **`weld_symbol`**: add `side` (select: arrow side / other side / both) — which side of the joint the weld is on relative to the symbol's reference line.
- **`surface_finish`**: no change for v1 — lay direction stays a later-tier concept, consistent with the KB doc's own tiering.

### 3.4 Confirmed Layer-1 addition: general tolerance grade

Per the KB doc, ISO 2768's letter grade (f/m/c/v) is *"your most-used fallback rule — most real dimensions have no explicit tolerance."* Layer 1 gains a 5th field, `general_tolerance_grade`, shown only when `standard = iso` — drawing-level, captured in the metadata modal alongside the existing 4 fields, not as its own entity category.

---

## 4. Data model changes needed for this phase

Everything in Phase 1's schema stays. This phase adds:

### 4.1 `regions.entities_status`
New column, `String(16)`, default `not_started`, values `not_started | in_progress | done` — tracks the Layer-3 "has this region's entity annotation been marked complete" state described in §2.3 step 13, separate from the existing Layer-2 `status` column (which keeps meaning exactly what it means today — whether the region box itself is finished).

### 4.2 `annotation_versions` — one new field
`general_tolerance_grade: String(4) | null` (`"f" | "m" | "c" | "v" | null`) — the Layer-1 addition from §3.4.

### 4.3 Version deletion — the confirmed rule

Today's `DELETE /annotation-versions/{id}` only handles deleting an unapproved draft fork and snapping back to the version it came from. This phase replaces it with:

1. Deleting **any** version (draft or approved, current or not) is allowed.
2. **If it's not the only version the drawing has**: after deleting it, the remaining version with the **highest `version_number`** becomes `is_current = true`. If the deleted version had something pointing at it via `superseded_by_id` (an older version marked "superseded by the thing I just deleted"), that pointer is cleared back to `null` — it's no longer accurate to say it was superseded by something that no longer exists. The promoted version's own `status` (draft/approved) is untouched by the promotion. Regions and entities belonging to the deleted version are deleted with it (already how the cascade works today).
3. **Confirmed — if it IS the only version the drawing has**: deleting it is still allowed, but the UI shows a clear warning first — *"This is the only version of this drawing. Deleting it will delete the entire drawing, including its upload record and hash — this can't be undone."* — with an explicit confirm step (not a silent cascade on the first click). Confirming deletes the version *and* cascades into deleting the `drawings` row itself, since a drawing with zero versions has no reason to exist. This needs its own confirmation step distinct from the ordinary version-delete confirmation, precisely because it's the more serious, harder-to-undo action.
4. A drawing's `content_hash` is freed up by this cascade — re-uploading that exact file afterward is treated as brand new (correct, since there's no annotation history left to dedupe against).

### 4.4 No backend change needed for the modal, the two-tab split, or the light-border region overlay

Those are pure frontend/UI changes against data that already exists (Layer 1 fields, regions, entities) — the backend surface area for this phase is genuinely small: two new columns/fields, and replacing the semantics of one existing endpoint.

---

## 5. API changes needed

- `PATCH /regions/{id}` — already exists, just needs `entities_status` added to its accepted fields (same pattern as the existing `status` field).
- `PATCH /annotation-versions/{id}` — already exists, just needs `general_tolerance_grade` added to its accepted fields.
- `DELETE /annotation-versions/{id}` — behavior replaced per §4.3 (any version; promotion logic; cascade-to-drawing when it's the last one, with a response that tells the frontend whether the whole drawing was deleted so it can navigate back to the drawing list instead of to a now-nonexistent drawing page).
- `POST /annotation-versions/{id}/approve` — gating logic changes (checked client-side today via `canApprove`; also enforced server-side that every region has both `status = done` and `entities_status = done` before allowing approval, so the rule can't be bypassed by calling the API directly).
- Everything else (drawings, upload, dedup, export, AI-suggest) is untouched by this phase.

---

## 6. Cleanup — the exact, grounded deletion/refactor list

Confirmed by reading the actual files, not guessed:

**Delete outright (backend):**
- `app/models/file.py`, `app/schemas/file.py`, `app/api/routes/files.py` — the entire legacy `files` table and its endpoints. Nothing in the new flow touches this table.
- The `files.router` line in `app/main.py`.
- A new Alembic migration that cleanly `DROP TABLE files` (existing migration history that created it stays untouched — migration history isn't rewritten).

**Delete outright (frontend):**
- `pages/FileLibraryPage.tsx`, `pages/FileWorkspacePage.tsx`, `components/FileListItem.tsx`.
- The `/` and `/files/:fileId` routes in `App.tsx`, and the "Files" nav link.
- `/drawings` becomes the new home page (`/`) once the old home is gone.

**Keep, but first extract the shared bits before deleting their container:**
- `types/file.ts` is *not* pure legacy — `DxfBackground.tsx`, `PdfBackground.tsx`, and the new `AnnotationTracerCanvas.tsx` all import shared constants from it (`VIEWABLE_FORMATS`, `IMAGE_VIEWABLE_FORMATS`, `VIEWABLE_3D_FORMATS`). Move those constants into a small shared file (e.g. `types/format.ts`) first, then delete the rest of `file.ts` (the old `FileRecord` type and anything else specific to the deleted table).
- `DxfBackground.tsx`, `PdfBackground.tsx`, `ThreeDViewer.tsx` and their supporting libs (`lib/dxf.ts`, `lib/pdfjs.ts`, `lib/three.ts`, `lib/occt.ts`) are **genuinely still needed** — these are the actual sheet/model renderers for DXF/PDF/STL/OBJ/STEP/IGES, used by the real annotation workspace, not legacy at all. Leave them exactly where they are.
- `ai.py`, `ai_suggest.py`, `captureStage.ts`, `regionEdit.ts`'s AI-suggest call — already correctly pointed at `annotation_version_id`, already not legacy. Leave as-is; worth revisiting later (per the original Phase-1 plan's own note) to extend AI-suggest into proposing Layer-3 entities too, but that's not part of this phase.
- `UploadDropzone.tsx` — shared by both the old and new flows today; keep, it has no legacy-specific logic in it.

---

## 7. Frontend redesign — structure and theming

### 7.1 Component/page structure (target state after this phase)

- `/` → the drawing list (today's `/drawings`, promoted to the home route) — upload, dedup, list with status badges (`draft` / `in progress` / `annotated`).
- `/annotation-versions/:id` → rebuilt as a two-tab workspace: **Regions** and **Entities**, per §2.2–2.3, instead of today's single combined view. The metadata modal (§2.1) is a new component, shown conditionally rather than always-inline.
- `/export` → unchanged.
- New small components worth factoring out cleanly rather than growing the existing 863-line `AnnotationVersionPage.tsx` further: `MetadataModal.tsx`, `RegionsTab.tsx`, `EntitiesTab.tsx`, `VersionHistoryPanel.tsx` (already logically separate today as the `VersionHistory` function — worth promoting to its own file), each with a clear, single job — one file, one responsibility, instead of one page file doing everything.

### 7.2 Light/dark mode

Confirmed from reading `global.css`: the app already consistently uses CSS custom properties (`var(--surface)`, `var(--border)`, `var(--accent)`, `var(--radius-lg)`, etc.) everywhere, with exactly one palette defined and hardcoded to dark. Concretely, this phase:
1. Defines a light palette alongside the existing dark one, keyed off `:root[data-theme="light"]` / `:root[data-theme="dark"]` (plus a `prefers-color-scheme` default for a first-time visitor who hasn't chosen yet).
2. Adds a small theme toggle in the topbar, persisting the choice in `localStorage`.
3. No component should need touching beyond the toggle itself and the new palette block — because the variables are already used consistently, this is additive, not a rewrite.

### 7.3 General UI polish

Once the two-tab flow and modal exist, worth a pass on: consistent spacing/typography scale, the region/entity list panels (currently a mix of class-based styles and inline `style={}` props — worth consolidating to one approach), and clear visual states for region/entity status (not started / in progress / done) using color + icon, not just a text badge, so progress is scannable at a glance.

---

## 8. Build order for this phase

1. **Cleanup first** (§6) — delete the legacy `files` subsystem, extract shared format constants, land on a clean `/` route. Foundational and low-risk (deletion of confirmed-dead code); doing it first means every slice after this is built against a codebase with no legacy confusion left in it.
2. **Schema additions** (§4.1, §4.2) — `regions.entities_status`, `annotation_versions.general_tolerance_grade`, plus the version-delete-and-promote rule and its cascade-to-drawing behavior (§4.3) and endpoint.
3. **Metadata modal** (§2.1) — replace the inline Layer 1 form, with pre-fill-on-fork.
4. **Two-tab split** (§2.2, §2.3) — the biggest UI slice: Regions tab with the Done-checkbox-per-region flow and the "Proceed to entity annotation" gate; Entities tab with the light-border region overlay, per-region entity annotation, and the per-region entity-phase Done button.
5. **"Save annotations" gating update** (§2.3 step 14, §5) — extend the approve gate to also require `entities_status = done` everywhere, enforced both client- and server-side.
6. **"Enable editing" relabel + copy-forward behavior** (§2.5) — rename the button and change forking to copy regions/entities forward into the new draft instead of starting blank.
7. **Version delete UI, including the last-version-cascades-the-drawing warning** (§2.5 step 20, §4.3) — wire the new delete-any-version endpoint into the version history panel, with the distinct, more serious confirmation step for the last-version case.
8. **Entity field additions** (§3.3) — the confirmed payload-field additions per category.
9. **Light/dark theme** (§7.2) — palette + toggle.
10. **General polish pass** (§7.3) — once everything above is functionally in place.

Each of these is independently shippable and testable, same discipline as Phase 1.

---

## 9. Decisions — confirmed 2026-10-04

All six open items are now settled:

1. **Continuous per-region saving** (§2.2 step 7) — confirmed, going with the recommendation over the literal batch-save-on-Proceed reading.
2. **Copy-forward on "Enable editing"** (§2.5 step 18) — confirmed; supersedes the original Phase-1 "fork copies nothing" decision.
3. **Deleting a drawing's last remaining version** (§4.3) — confirmed as cascade-to-drawing-deletion, gated behind an explicit warning and a distinct confirm step, not a silent block and not a silent cascade.
4. **Entity field additions** (§3.3) — confirmed as listed.
5. **General tolerance grade field** (§3.4, §4.2) — confirmed.
6. **Git/uncommitted-changes state** (§0) — confirmed resolved; the other session's work is done, and this plan proceeds against the current working tree as the real baseline.

This document is final. Ready to hand to Claude Code as-is — built slice by slice per §8.
