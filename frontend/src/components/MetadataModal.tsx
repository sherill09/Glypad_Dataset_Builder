import { useState } from "react";
import type { FormEvent } from "react";

import type { AnnotationStandard, AnnotationVersionUpdate, GeneralToleranceGrade } from "../types/drawing";

const STANDARDS: { value: AnnotationStandard; label: string }[] = [
  { value: "iso", label: "ISO" },
  { value: "asme", label: "ASME" },
];

const TOLERANCE_GRADES: { value: GeneralToleranceGrade; label: string }[] = [
  { value: "f", label: "f — fine" },
  { value: "m", label: "m — medium" },
  { value: "c", label: "c — coarse" },
  { value: "v", label: "v — very coarse" },
];

export interface MetadataModalDefaults {
  standard: AnnotationStandard | null;
  units: string | null;
  discipline: string | null;
  scale: string | null;
  general_tolerance_grade: GeneralToleranceGrade | null;
}

interface MetadataModalProps {
  /** Starting values — the version's own fields merged with the
   * forked-from version's values for whichever fields are still blank
   * (PHASE2_IMPLEMENTATION_PLAN.md §2.1 step 5, "pre-fill-on-fork"). */
  defaults: MetadataModalDefaults;
  /** True once this version has already had metadata submitted at least
   * once before (so the heading can say "confirm" instead of "add"). */
  isForkedVersion: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (patch: AnnotationVersionUpdate) => void;
}

/**
 * The Layer 1 metadata modal (PHASE2_IMPLEMENTATION_PLAN.md §2.1) — a
 * genuine blocking modal, not the old always-visible inline form it
 * replaces. Shown on top of the viewer for every non-approved version;
 * drawing starts only once this is submitted. No dismiss/close action by
 * design — even an unchanged, all-blank submission is a deliberate
 * "nothing to record yet" confirmation, not a skip.
 */
export function MetadataModal({ defaults, isForkedVersion, saving, error, onSubmit }: MetadataModalProps) {
  const [standard, setStandard] = useState<AnnotationStandard | "">(defaults.standard ?? "");
  const [units, setUnits] = useState(defaults.units ?? "");
  const [discipline, setDiscipline] = useState(defaults.discipline ?? "");
  const [scale, setScale] = useState(defaults.scale ?? "");
  const [toleranceGrade, setToleranceGrade] = useState<GeneralToleranceGrade | "">(defaults.general_tolerance_grade ?? "");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      standard: standard || null,
      units: units || null,
      discipline: discipline || null,
      scale: scale || null,
      // Cleared automatically when the standard isn't ISO -- ISO 2768 is
      // an ISO-only concept, so a stale ASME-drawing grade never lingers.
      general_tolerance_grade: standard === "iso" ? toleranceGrade || null : null,
    });
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="metadata-modal-title">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <h2 id="metadata-modal-title">Drawing metadata</h2>
          <p>
            {isForkedVersion
              ? "Confirm or adjust the tolerancing details before editing this version."
              : "A few details about this sheet before you start marking it up."}
          </p>
        </div>

        <div className="modal-body">
          <div className="layer1-grid">
            <div className="field">
              <label htmlFor="meta-standard">Tolerancing standard</label>
              <select
                id="meta-standard"
                className="input"
                autoFocus
                value={standard}
                onChange={(e) => setStandard(e.target.value as AnnotationStandard | "")}
              >
                <option value="">— not set —</option>
                {STANDARDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="meta-units">Units</label>
              <input id="meta-units" className="input" placeholder="e.g. mm" value={units} onChange={(e) => setUnits(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="meta-discipline">Discipline</label>
              <input
                id="meta-discipline"
                className="input"
                placeholder="e.g. mechanical"
                value={discipline}
                onChange={(e) => setDiscipline(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="meta-scale">Scale</label>
              <input id="meta-scale" className="input" placeholder="e.g. 1:50" value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>
            {standard === "iso" && (
              <div className="field layer1-fullwidth">
                <label htmlFor="meta-tolerance-grade">General tolerance grade (ISO 2768)</label>
                <select
                  id="meta-tolerance-grade"
                  className="input"
                  value={toleranceGrade}
                  onChange={(e) => setToleranceGrade(e.target.value as GeneralToleranceGrade | "")}
                >
                  <option value="">— not set —</option>
                  {TOLERANCE_GRADES.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
                <span className="hint">The fallback tolerance that applies to any dimension with no tolerance of its own.</span>
              </div>
            )}
          </div>
          {error && <p className="error-banner" style={{ marginTop: 12 }}>{error}</p>}
        </div>

        <div className="modal-footer">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
