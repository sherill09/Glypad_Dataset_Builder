import { Link } from "react-router-dom";

import type { AnnotationVersion, AnnotationVersionSummary } from "../types/drawing";

interface VersionHistoryPanelProps {
  current: AnnotationVersion;
  others: AnnotationVersionSummary[];
  confirmingDeleteId: string | null;
  deletingId: string | null;
  onRequestDelete: (id: string) => void;
}

/**
 * Lists every other version of this drawing, each with its own delete
 * action (PHASE2_IMPLEMENTATION_PLAN.md §2.5 step 20, §7.1 -- promoted to
 * its own file in slice 10, same component this page always called
 * VersionHistory, just relocated and renamed to match the plan's naming).
 *
 * Deliberately hidden when there are no others -- the version being
 * viewed already has its own "Delete version" button in the page header,
 * which is the only place the last-version warning (DeleteDrawingWarningModal
 * below) can ever trigger: a row here always has at least one sibling left
 * over after it's deleted, so it never needs that serious confirmation.
 */
export function VersionHistoryPanel({ current, others, confirmingDeleteId, deletingId, onRequestDelete }: VersionHistoryPanelProps) {
  if (others.length === 0) return null;
  const all = [{ ...current } as AnnotationVersionSummary, ...others].sort((a, b) => b.version_number - a.version_number);
  return (
    <details className="version-history">
      <summary className="version-history__summary">Version history · {all.length}</summary>
      <div className="version-history__list">
        {all.map((v) => (
          <div key={v.id} className="version-history__row">
            <strong>v{v.version_number}</strong>
            <span className={`badge badge--status-${v.status}`}>{v.status}</span>
            {v.is_current && <span className="badge badge--accent">current</span>}
            <span className="hint">
              {v.created_by_email ? `by ${v.created_by_email}` : ""}
              {v.approved_at ? ` · approved ${new Date(v.approved_at).toLocaleDateString()}` : ""}
            </span>
            <div className="spacer" />
            {v.id === current.id ? (
              <span className="hint">viewing this one</span>
            ) : (
              <>
                <Link to={`/annotation-versions/${v.id}`}>View →</Link>
                <button
                  type="button"
                  className={"btn btn--small btn--danger" + (confirmingDeleteId === v.id ? " btn--confirm" : "")}
                  disabled={deletingId === v.id}
                  onClick={() => onRequestDelete(v.id)}
                  title="Delete this version"
                >
                  {deletingId === v.id ? "Deleting…" : confirmingDeleteId === v.id ? "Confirm?" : "Delete"}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * The distinct, more serious confirmation for deleting a drawing's only
 * remaining version (PHASE2_IMPLEMENTATION_PLAN.md §4.3 point 3) -- a
 * real modal rather than the quick two-click pattern the ordinary
 * (sibling-remains) delete case uses, since this one cascades into
 * deleting the whole drawing and can't be undone. Co-located here with
 * VersionHistoryPanel rather than in its own file since it's small and
 * exists only to serve this page's version-deletion flow, triggered from
 * both the page header's own "Delete version" button and (in principle)
 * this panel -- though in practice only the header ever can, per the
 * note above.
 */
export function DeleteDrawingWarningModal({
  filename,
  deleting,
  onCancel,
  onConfirm,
}: {
  filename: string;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-drawing-title">
      <div className="modal">
        <div className="modal-header">
          <h2 id="delete-drawing-title">Delete the entire drawing?</h2>
          <p>{filename}</p>
        </div>
        <div className="modal-body">
          <p className="note-box note-box--danger">
            This is the only version of this drawing. Deleting it will delete the entire drawing, including its
            upload record and hash — this can't be undone.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost btn--small" disabled={deleting} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger btn--small" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : "Delete drawing"}
          </button>
        </div>
      </div>
    </div>
  );
}
