import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError, createDatasetVersion, listDatasetVersions, previewExport } from "../api/client";
import type { DatasetVersion, ExportPreview } from "../types/dataset";

/**
 * The export screen (IMPLEMENTATION_PLAN.md §5 step 8, slice 7) — a
 * separate, manual, whole-dataset action, not something that happens
 * per-drawing or automatically (§2 decision 6). "Create dataset version"
 * builds a COCO-style JSON covering every drawing's *current, approved*
 * annotation version, offers it as a browser download, and records a
 * `dataset_versions` row with just the snapshot's metadata — the export
 * content itself is never stored server-side, only ever regenerated fresh
 * each time this is clicked.
 */
export function ExportPage() {
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [history, setHistory] = useState<DatasetVersion[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastExported, setLastExported] = useState<DatasetVersion | null>(null);

  async function refresh() {
    try {
      const [p, h] = await Promise.all([previewExport(), listDatasetVersions()]);
      setPreview(p);
      setHistory(h);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const result = await createDatasetVersion(notes.trim() || null);
      const blob = new Blob([JSON.stringify(result.export, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dataset_v${result.dataset_version.version_number}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLastExported(result.dataset_version);
      setNotes("");
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="page">Loading…</div>;

  const canExport = !!preview && preview.drawing_count > 0;

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <Link to="/drawings" className="back-link">
        ← Back to drawings
      </Link>
      <h1 style={{ fontSize: 18, margin: 0 }}>Export dataset</h1>
      <p className="hint">
        Builds a COCO-style JSON covering every drawing's current, approved annotation version — a drawing with no
        approved version, or whose current version is a draft someone's mid-way through on a forked version, isn't
        included. This is a whole-dataset snapshot, triggered manually, not something that happens automatically.
      </p>

      {error && <p className="error-banner">{error}</p>}
      {lastExported && (
        <p className="note-box note-box--info">
          Downloaded dataset v{lastExported.version_number} — {lastExported.drawing_count} drawing
          {lastExported.drawing_count === 1 ? "" : "s"}, {lastExported.annotation_count} annotation
          {lastExported.annotation_count === 1 ? "" : "s"}.
        </p>
      )}

      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          {preview && preview.drawing_count > 0 ? (
            <span className="hint">
              Ready to export: <strong>{preview.drawing_count}</strong> drawing{preview.drawing_count === 1 ? "" : "s"},{" "}
              <strong>{preview.annotation_count}</strong> annotation{preview.annotation_count === 1 ? "" : "s"}.
            </span>
          ) : (
            <span className="hint">No drawing has a current, approved version yet — nothing to export.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="notes">Notes (optional)</label>
          <input
            id="notes"
            className="input"
            placeholder="e.g. pre-v2-training-run export"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <button type="button" className="btn btn--ok" disabled={!canExport || exporting} onClick={handleExport}>
            {exporting ? "Exporting…" : "📦 Create dataset version"}
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 15, marginTop: 24 }}>Past exports · {history.length}</h2>
      {history.length === 0 ? (
        <p className="hint">No dataset version has been created yet.</p>
      ) : (
        <div className="table-responsive">
          <table className="file-table">
            <thead>
              <tr>
                <th>VERSION</th>
                <th>CREATED</th>
                <th>BY</th>
                <th>DRAWINGS</th>
                <th>ANNOTATIONS</th>
                <th>NOTES</th>
              </tr>
            </thead>
            <tbody>
              {history.map((dv) => (
                <tr key={dv.id}>
                  <td>v{dv.version_number}</td>
                  <td>{new Date(dv.created_at).toLocaleString()}</td>
                  <td>{dv.created_by_email ?? "—"}</td>
                  <td>{dv.drawing_count}</td>
                  <td>{dv.annotation_count}</td>
                  <td>{dv.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
