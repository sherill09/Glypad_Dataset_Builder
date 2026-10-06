# Glypad Dataset Builder

Upload 2D drawings and 3D models, classify them, trace regions on the 2D
sheets, and approve them for a model-training dataset.

This is the real-application version of the Claude artifact prototype —
same ideas, now running on your own stack: **FastAPI + PostgreSQL + S3
(or local disk while developing) on the backend, React on the frontend.**

## Project layout

```
glypad-dataset-builder/
├── backend/            FastAPI application (Python)
│   ├── app/
│   │   ├── main.py            entrypoint — creates the app, wires routers
│   │   ├── core/               settings + database connection
│   │   ├── models/             database tables (SQLAlchemy)
│   │   ├── schemas/            API request/response shapes (Pydantic)
│   │   ├── api/routes/         the actual endpoints
│   │   └── services/           storage backend + file classification logic
│   ├── alembic/                 database migrations (schema history)
│   └── tests/
├── frontend/            React application (TypeScript + Vite)
│   └── src/
│       ├── api/                talks to the backend over HTTP
│       ├── types/               TypeScript types matching the backend's schemas
│       ├── components/          small reusable pieces (dropzone, table row, ...)
│       └── pages/                full pages built from components
├── storage/local_files/  where uploaded files land in local development
└── docker-compose.yml    runs PostgreSQL in a container
```

This structure — separating `models` (database), `schemas` (API shapes),
`api/routes` (endpoints) and `services` (business logic) on the backend,
and `api` / `types` / `components` / `pages` on the frontend — is a
standard, common way to organize a project like this. As the app grows,
you always know where a given piece of logic belongs.

## What's built so far

- Upload a file → it gets classified (2D/3D, vector/raster, text layer or
  not, complexity) → the file's bytes are stored → its metadata is saved
  in PostgreSQL.
- List, filter, sort, rename, add notes to, and delete files.
- Create/update/delete regions (bounding boxes) on a file, through the API.
- Approve a file (and it correctly reverts to "draft" if you change its
  regions afterward, same rule the original artifact used).
- The frontend has two pages now (routed with `react-router-dom`):
  - **File library** (`/`) — drag-and-drop upload, a filter bar (category,
    representation, text layer, complexity, status, name search), and a
    manifest-style table where every column header is click-to-sort
    (click again to reverse). Filtering and sorting both happen in the
    browser against the list already fetched, the same way the original
    artifact's Manifest tab worked.
  - **File workspace** (`/files/:id`) — click any file to open it. For
    SVG/PNG/JPG/PDF/DXF sheets, this is the full tracer: Pen, Box and
    Select tools, pan, zoom (+/−/Fit/100%), a region list you can edit
    (type, caption, notes) and delete from, a Notes field, and
    Approve/Delete. For 3D models (STL, OBJ, STEP, IGES), this is a
    rotate/zoom 3D viewer instead (3D files don't get the region tracer —
    same as the original artifact, they're upload + classify + view, no
    annotation workflow). Formats without a live viewer (TIFF) show a
    clear "not available yet" card instead of pretending to work.
- **Editable regions.** Any region — hand-drawn or AI-suggested — can be
  adjusted after it's created. Click a region to select it (Select tool),
  then drag its body to move it, or drag **any edge or corner** to resize
  it — the whole border is a grab zone (it lights up under the cursor), not
  just the small squares. Every region gets 8 bounding-box handles (for a
  Pen polygon these scale the whole shape); Pen polygons also get a round
  handle per vertex to reshape one corner. Handles work in any tool, so a
  region you just drew can be adjusted immediately. Everything is clamped to
  the sheet — including when you pull an edge past its border — and when you
  release the mouse the final coordinates are saved to the database with a
  `PATCH`: what you see is what's stored. **Esc** cancels a drag in progress.
- **Merging and deleting.** Hold **Cmd/Ctrl** (or Shift) and click regions
  to select several — in any tool. A **Merge** bar appears over the sheet
  (the panel's checkboxes and Merge button do the same); click Merge to
  replace them with one region whose box covers all of them, or press
  **Esc** to unselect everything. The merge is a single backend call
  (`POST /files/{id}/regions/merge`), done in one transaction. Delete
  removes everything selected (× in the panel, **Delete selected**, or the
  Delete key). Any of these on an approved file sends it back to "draft".
  The drag math lives in `frontend/src/lib/regionEdit.ts`; the merge rules in
  `backend/app/services/regions.py` (tested in `tests/test_regions.py`).
- **Undo/redo**, for every region edit made before approving: drawing,
  moving/resizing, editing a field, deleting, merging, and AI-suggested
  regions. Every edit is saved immediately (there's no separate "draft" held
  only in the browser — see the region-editing bullet above), so "undo"
  replays the same real API calls to reverse a change, not a client-side
  rewind: undoing a delete re-creates the region (as a new row, with a new
  id, but the same type/caption/notes/points/source), undoing a move/edit
  reverts to the previous value, and undoing a merge restores every region
  it combined. **Ctrl/Cmd+Z** undoes, **Ctrl/Cmd+Shift+Z** (or +Y) redoes —
  or use the toolbar's Undo/Redo buttons, which show what they'd undo/redo
  in their tooltip and disable themselves once there's nothing left. Doing
  something new after an undo clears the redo stack, the usual rule. The
  shortcuts are ignored while typing in a caption/notes field, so the
  browser's own native undo works there instead. History is per file and
  per browser tab — it doesn't survive a page reload or follow you to a
  different file, and (being about regions specifically) doesn't cover
  renaming the file or editing its own notes/complexity fields. The stack
  lives in `frontend/src/lib/undoHistory.ts`; the individual undo/redo
  actions are defined in `frontend/src/pages/FileWorkspacePage.tsx` next to
  each handler they reverse.
- PDF sheets render their first page with **pdf.js** (loaded lazily from a
  CDN, so people who never open a PDF never download it); a note appears
  if a PDF has more than one page, since only page 1 is shown. DXF sheets
  are drawn with a small dependency-free parser
  (`frontend/src/lib/dxf.ts`) that understands LINE/CIRCLE/ARC/
  (LW)POLYLINE/TEXT entities — a best-effort preview, not a full CAD
  reader, which is enough to see the shape of most simple 2D drawings.
  Either way, the tracer overlay (drawing/selecting regions) doesn't care
  whether the sheet underneath is a plain image or one of these — it just
  needs a pixel size back.
- All four 3D formats get a live 3D viewer
  (`frontend/src/components/ThreeDViewer.tsx`): the mesh is centered, lit,
  and dropped onto a ground grid, with a small built-in
  drag-to-rotate/scroll-to-zoom control — no separate OrbitControls script
  needed. STL and OBJ are parsed directly with **three.js**'s own loaders
  (loaded lazily from a CDN). STEP and IGES are full CAD (B-rep) formats,
  so they're parsed with **occt-import-js**, a WASM build of the
  OpenCascade CAD kernel that reads the real B-rep geometry and
  triangulates it, loaded lazily from a CDN the same way
  (`frontend/src/lib/occt.ts`) — the WASM download is several megabytes
  and is only fetched the first time someone opens a STEP or IGES file in
  a session, the same lazy-load-only-if-you-use-it approach already used
  for three.js and pdf.js. occt-import-js is LGPL-2.1-licensed; it's
  loaded at runtime from a CDN rather than bundled or modified, which is a
  non-issue for a self-hosted internal tool but worth stating plainly.
- The tracer's drawing math (screen clicks → exact pixel coordinates on
  the sheet, for the pen tool and the box-drag tool, across SVG/PNG/JPG
  as well as the PDF/DXF canvas backgrounds) was verified with an actual
  headless-browser test — draw a region, and its stored points match the
  intended coordinates exactly. The 3D viewer was verified the same way:
  loaded a real STL cube, a real OBJ cube, a real STEP part, and a real
  IGES part, confirmed the WebGL canvas actually rendered visible geometry
  for each (not just "didn't crash"), confirmed dragging genuinely rotates
  the camera (the rendered frame changes), and confirmed a corrupt file
  with a STEP/IGES extension fails gracefully into the existing "couldn't
  be loaded" card instead of crashing the page.
- The manifest table's filters and sorting were verified with a real
  headless-browser test too — uploaded a mixed batch of real files,
  confirmed each filter actually narrows the visible rows to the right
  set (not just that the dropdown exists), and confirmed sorting by a
  text column and by size both produce the correct order both ways
  (ascending on the first click, reversed on the second) — size sorts by
  the real byte count, not by the displayed "1.5 KB" text.
- **Authentication.** Every teammate gets their own account (email +
  password) — there's no shared login. Signing in gets you a token that's
  sent with every request; the whole API is behind it, including the
  `/files/{id}/content` endpoint that the tracer and 3D viewer load images
  and models from. Every uploaded file records who uploaded it, and the
  file workspace shows "uploaded by ...". Everyone with an account can see
  and work on every file — this is a shared team tool, not per-user
  private storage — individual accounts exist so you can tell who did
  what, not to wall people off from each other's files. Verified with a
  real headless-browser test: registering, uploading while signed in,
  logging out (and confirming the app is genuinely unreachable, not just
  hiding the UI), a wrong password being rejected, logging back in and
  finding the same file still there, and an expired/garbage token being
  handled gracefully (signed out cleanly, not a crash).
- **AI-assisted region suggestion**, using Google's Gemini models (the
  original artifact used Claude's built-in "sample" capability, which only
  exists inside an artifact — this calls the real Gemini API instead). An
  "✨ AI suggest" button in the tracer sends whatever's currently on
  screen to Gemini and asks it to find the sheet's regions (views, section
  views, detail views, title block, parts list, dimension blocks, notes);
  what comes back is added as ordinary regions, tagged so you can tell
  they came from AI, and still needs your review before the file can be
  approved — same "AI proposes, a person confirms" shape as the original
  artifact. If `GEMINI_API_KEY` isn't set, the button fails with a clear
  "not configured" message instead of pretending to work — verified with a
  real headless-browser test of exactly that path. The parsing logic that
  turns Gemini's reply into regions (handling out-of-range coordinates,
  swapped corners, unknown region types, slivers too thin to be real) has
  its own unit tests in `backend/tests/test_ai_suggest.py`, run with a
  mocked reply so they don't need a real API key or network access.

## What's not built yet

Nothing major is outstanding right now — the app has authentication, the
AI-suggest feature, and a full Docker-based deployment setup (see
[Deploying it for your team to use](#deploying-it-for-your-team-to-use)
below). The one honest caveat: the deployment setup (the `Dockerfile`s,
`docker-compose.prod.yml`, and `DEPLOYMENT.md`) was written and reviewed
carefully but hasn't been run end-to-end on a real AWS server, since that
needs an actual AWS account and a running Docker daemon — neither
available in the environment this project was built in. See the closing
note in `DEPLOYMENT.md` for details.

## Running it locally

You'll need: **Python 3.11+**, **Node.js 18+**, and **Docker Desktop**.

### 1. Start the database

From the project root:

```bash
docker compose up -d
```

This starts PostgreSQL in the background. Check it's healthy with
`docker compose ps` — it should say "healthy" after a few seconds.

### 2. Start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # on Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # defaults already match docker-compose.yml
alembic upgrade head             # creates the users/files/regions tables
uvicorn app.main:app --reload
```

The API is now running at **http://localhost:8000**. FastAPI gives you a
free interactive page to try every endpoint by hand, without writing any
code — open **http://localhost:8000/docs** and take a look.

The checked-in `.env.example` has a working `SECRET_KEY` default for local
development — you don't need to change it to get the app running. You
**do** need a real one before deploying anywhere real (see below).
`GEMINI_API_KEY` can stay blank while you develop; the "AI suggest"
button will just show a clear "not configured" message instead of
crashing until you add one.

### 3. Start the frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:5173** — you'll land on a sign-in page. Click
"Create one" to register the first account (any email/password works
locally), then you're in. Drop a file on the upload page and watch it
appear in the table below, coming straight from Postgres.

### Running the tests

```bash
cd backend
pytest
```

## Switching file storage from local disk to Amazon S3

Everything above uses `STORAGE_BACKEND=local` in `backend/.env`, which
saves uploaded files under `storage/local_files/` on your own machine —
no AWS account needed for development.

When you're ready to point it at real S3, edit `backend/.env`:

```
STORAGE_BACKEND=s3
AWS_S3_BUCKET=your-bucket-name
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

No code changes needed — `app/services/storage.py` is the one place that
decides which backend to use, based on this setting.

## Deploying it for your team to use

Everything above runs the app on your own machine only. To put it on a
real server your team can reach from a URL — a self-managed PostgreSQL
container (not a managed database service) alongside the backend and
frontend, all running in Docker on an AWS EC2 instance — see
**[DEPLOYMENT.md](DEPLOYMENT.md)** for the full, beginner-friendly
walkthrough: launching the instance, installing Docker, filling in
production secrets, starting everything with `docker-compose.prod.yml`,
and day-to-day maintenance (deploying updates, logs, backups).
