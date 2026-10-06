import { REGION_TYPES, type Entity, type Region } from "../types/annotation";
import { IconArrowRight, IconCheck, IconChevronDown, IconTrash } from "./Icons";

interface RegionsTabProps {
  regions: Region[];
  entities: Entity[];
  readOnly: boolean;
  /** The one region whose full edit panel stays open even though it's
   * already marked done (§2.2 step 7) -- every not-done region is always
   * open regardless of this. */
  expandedRegionId: string | null;
  selectedRegionIds: string[];
  /** regions.length > 0 && every region status === "done" -- the
   * region-phase half of the page's "Save annotations" gate (the other
   * half, entities_status, only applies once every region is here). */
  canProceed: boolean;
  onSelectRegion: (id: string) => void;
  onRegionChange: (id: string, patch: Partial<Pick<Region, "type" | "caption" | "notes" | "status">>) => void;
  onToggleDone: (id: string, done: boolean) => void;
  onDeleteRegion: (id: string) => void;
  onProceed: () => void;
}

/**
 * Tab 1 of the guided annotation flow (PHASE2_IMPLEMENTATION_PLAN.md
 * §2.2): draw a region on the canvas, describe it here, check it done.
 * A not-done region's panel always stays open since it still needs
 * attention; a done one collapses to a single-line summary, re-opened by
 * clicking it. Regions keep saving continuously as they're edited -- the
 * Done checkbox doesn't introduce any batching, it's just the one field
 * that also collapses the panel when it's checked on.
 */
export function RegionsTab({
  regions,
  entities,
  readOnly,
  expandedRegionId,
  selectedRegionIds,
  canProceed,
  onSelectRegion,
  onRegionChange,
  onToggleDone,
  onDeleteRegion,
  onProceed,
}: RegionsTabProps) {
  return (
    <div className="region-section">
      <div className="region-section__header">
        <h2>Regions · {regions.length}</h2>
        {!readOnly && (
          <button
            type="button"
            className="btn btn--primary btn--small btn--proceed"
            disabled={!canProceed}
            title={!canProceed ? "Mark every region done first" : undefined}
            onClick={onProceed}
          >
            <span>Proceed to entity annotation</span>
            <IconArrowRight size={13} />
          </button>
        )}
      </div>

      <div className="region-panel">
        {regions.length === 0 && (
          <p className="hint region-panel-empty">Pick Pen or Box from toolbar to draw a region (title block, a view, dimension block, …).</p>
        )}
        {regions.map((region, idx) => {
          const regionEntityCount = entities.filter((en) => en.region_id === region.id).length;
          const isSelected = selectedRegionIds.includes(region.id);
          const isDone = region.status === "done";
          const isOpen = !isDone || expandedRegionId === region.id;

          if (!isOpen) {
            return (
              <div
                key={region.id}
                id={`region-item-${region.id}`}
                className={"region-item region-item--compact" + (isSelected ? " region-item--selected" : "")}
                onClick={() => onSelectRegion(region.id)}
                role="button"
                tabIndex={0}
              >
                <div className="region-item__top">
                  <span className="region-item__label">R{idx + 1}</span>
                  <span className="region-item__type">{region.caption || region.type}</span>
                  <span className="badge badge--status-done">
                    <IconCheck size={11} /> done
                  </span>
                </div>
                <div className="region-item__compact-actions">
                  <span className="hint">
                    {regionEntityCount} entit{regionEntityCount === 1 ? "y" : "ies"}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small btn--icon-only"
                      title="Delete this region"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteRegion(region.id);
                      }}
                    >
                      <IconTrash size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={region.id}
              id={`region-item-${region.id}`}
              className={"region-item" + (isSelected ? " region-item--selected" : "")}
              onClick={() => onSelectRegion(region.id)}
            >
              <div className="region-item__top">
                <span className="region-item__label">R{idx + 1}</span>
                <div className="select-wrap" style={{ flex: 1 }}>
                  <select
                    className="input input--small input--select"
                    disabled={readOnly}
                    value={region.type}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onRegionChange(region.id, { type: e.target.value })}
                  >
                    {REGION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown size={14} className="select-arrow" />
                </div>
                {!readOnly && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--small btn--icon-only"
                    title="Delete this region"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRegion(region.id);
                    }}
                  >
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
              <input
                key={`cap:${region.id}:${region.caption ?? ""}`}
                className="input input--small"
                disabled={readOnly}
                placeholder="Caption (e.g. Front View, Notes)"
                defaultValue={region.caption ?? ""}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => onRegionChange(region.id, { caption: e.target.value })}
              />
              <textarea
                key={`notes:${region.id}:${region.notes ?? ""}`}
                className="input input--small"
                disabled={readOnly}
                placeholder="Notes (optional)"
                defaultValue={region.notes ?? ""}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => onRegionChange(region.id, { notes: e.target.value })}
              />
              <div className="region-item__footer">
                <span className="hint">
                  {regionEntityCount} entit{regionEntityCount === 1 ? "y" : "ies"}
                </span>
                {!readOnly && (
                  <label className="done-checkbox" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isDone} onChange={(e) => onToggleDone(region.id, e.target.checked)} />
                    Done
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
