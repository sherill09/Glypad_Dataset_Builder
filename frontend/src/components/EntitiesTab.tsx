import { useEffect, useRef, useState } from "react";
import type React from "react";

import {
  ENTITY_KINDS,
  KIND_LABELS,
  REGION_STATUS_LABELS,
  SUBTYPE_LABELS,
  type Entity,
  type EntityKind,
  type ParsedValues,
  type Region,
  type RegionStatus,
} from "../types/annotation";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconCheckCheck,
  IconChevronDown,
  IconInfo,
  IconTrash,
} from "./Icons";

type EntityPatch = Partial<Pick<Entity, "kind" | "subtype" | "text" | "status" | "region_id">>;

interface EntitiesTabProps {
  regions: Region[];
  entities: Entity[];
  readOnly: boolean;
  /** The region currently open for naming (§2.3 step 11): null shows the
   * region picker, set shows that region's callouts. */
  entityDrawRegionId: string | null;
  selectedEntity: Entity | undefined;
  onArmRegion: (id: string) => void;
  onCancelArm: () => void;
  onSelectEntity: (id: string | null) => void;
  onDeleteEntity: (id: string) => void;
  onEntityChange: (id: string, patch: EntityPatch) => void;
  onMarkRegionEntitiesDone: (regionId: string) => void;
  onConfirmClean: (regionId: string) => void;
}

function StatusIndicator({ status }: { status: RegionStatus }) {
  if (status === "done") {
    return (
      <span className="badge badge--status-done">
        <IconCheck size={11} /> {REGION_STATUS_LABELS.done}
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="badge badge--status-in_progress">
        <span className="status-dot status-dot--warn" /> {REGION_STATUS_LABELS.in_progress}
      </span>
    );
  }
  return (
    <span className="badge badge--status-not_started">
      <span className="status-dot status-dot--neutral" /> {REGION_STATUS_LABELS.not_started}
    </span>
  );
}

/**
 * Tab 2 of the guided flow: pick a region, name every callout inside it,
 * mark the region done. Each callout has one text field (what's on the
 * sheet), a kind and a subtype. Values such as the nominal and tolerances
 * are read from that text by the server and shown here, not typed.
 */
export function EntitiesTab({
  regions,
  entities,
  readOnly,
  entityDrawRegionId,
  selectedEntity,
  onArmRegion,
  onCancelArm,
  onSelectEntity,
  onDeleteEntity,
  onEntityChange,
  onMarkRegionEntitiesDone,
  onConfirmClean,
}: EntitiesTabProps) {
  const armedRegion = entityDrawRegionId ? regions.find((r) => r.id === entityDrawRegionId) : undefined;

  if (armedRegion) {
    const armedIdx = regions.findIndex((r) => r.id === armedRegion.id);
    const regionEntities = entities.filter((en) => en.region_id === armedRegion.id);
    const toReview = regionEntities.filter((en) => en.status === "suggested").length;
    const cleanToReview = regionEntities.filter((en) => en.status === "suggested" && en.warnings.length === 0).length;

    return (
      <div className="region-section">
        {/* Navigation row */}
        <div className="region-nav-bar">
          <button type="button" className="btn btn--ghost btn--small btn--back" onClick={onCancelArm}>
            <IconArrowLeft size={13} /> Back to regions
          </button>
          {!readOnly && (
            <button
              type="button"
              className="btn btn--small btn--ok"
              disabled={toReview > 0}
              title={toReview > 0 ? `Review the ${toReview} suggested item${toReview === 1 ? "" : "s"} first` : "Complete this region"}
              onClick={() => onMarkRegionEntitiesDone(armedRegion.id)}
            >
              <IconCheckCheck size={13} /> Done with region
            </button>
          )}
        </div>

        {/* Batch action banner if clean suggestions exist */}
        {!readOnly && cleanToReview > 0 && (
          <div className="region-action-banner">
            <button type="button" className="btn btn--small btn--ok btn--full" onClick={() => onConfirmClean(armedRegion.id)}>
              <IconCheck size={14} /> Confirm {cleanToReview} clean suggestion{cleanToReview === 1 ? "" : "s"}
            </button>
          </div>
        )}

        {/* Region context summary */}
        <div className="region-info-card">
          <div className="region-info-card__top">
            <span className="region-item__label">R{armedIdx + 1}</span>
            <span className="region-info-card__title">{armedRegion.caption || armedRegion.type}</span>
            <StatusIndicator status={armedRegion.entities_status} />
          </div>
          <div className="region-info-card__meta">
            <span className="region-meta-tag">{regionEntities.length} callout{regionEntities.length === 1 ? "" : "s"}</span>
            {toReview > 0 ? (
              <span className="region-meta-tag region-meta-tag--warn">{toReview} to review</span>
            ) : regionEntities.length > 0 ? (
              <span className="region-meta-tag region-meta-tag--ok">All reviewed</span>
            ) : null}
          </div>
          {!readOnly && (
            <div className="region-info-card__hint">
              <IconInfo size={13} className="region-info-icon" />
              <span>Click a box to edit. Drag handles to resize. Choose Box (B) to draw.</span>
            </div>
          )}
        </div>

        {/* Callout cards list */}
        <div className="callout-list">
          {regionEntities.length === 0 && (
            <p className="hint region-panel-empty">No callouts in this region yet. Choose Box (B) to draw one.</p>
          )}
          {regionEntities.map((entity) => {
            const selected = selectedEntity?.id === entity.id;
            return (
              <EntityListItem
                key={entity.id}
                entity={entity}
                readOnly={readOnly}
                selected={selected}
                onSelect={() => onSelectEntity(entity.id)}
                onConfirm={() => onEntityChange(entity.id, { status: "confirmed" })}
                onDelete={() => onDeleteEntity(entity.id)}
                editor={
                  selected ? (
                    <EntityInspector
                      entity={entity}
                      readOnly={readOnly}
                      onChange={(patch) => onEntityChange(entity.id, patch)}
                      onDelete={() => onDeleteEntity(entity.id)}
                    />
                  ) : null
                }
              />
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="region-section">
      <div className="region-section__header">
        <h2>Regions · {regions.length}</h2>
      </div>
      <div className="region-panel">
        {regions.length === 0 && (
          <p className="hint region-panel-empty">No regions yet. Switch to the Regions tab to add one.</p>
        )}
        {regions.map((region, idx) => {
          const regionEntities = entities.filter((en) => en.region_id === region.id);
          const toReview = regionEntities.filter((en) => en.status === "suggested").length;
          return (
            <div
              key={region.id}
              id={`entity-region-item-${region.id}`}
              className="region-item region-item--compact"
              onClick={() => onArmRegion(region.id)}
              role="button"
              tabIndex={0}
            >
              <div className="region-item__top">
                <span className="region-item__label">R{idx + 1}</span>
                <span className="region-item__type">{region.caption || region.type}</span>
                <StatusIndicator status={region.entities_status} />
              </div>
              <span className="hint">
                {regionEntities.length} callout{regionEntities.length === 1 ? "" : "s"}
                {toReview > 0 && ` · ${toReview} to review`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function kindLabel(entity: Entity): string {
  const sub = entity.subtype ? SUBTYPE_LABELS[entity.kind]?.[entity.subtype] : undefined;
  return sub ? `${KIND_LABELS[entity.kind]} · ${sub}` : KIND_LABELS[entity.kind];
}

function EntityListItem({
  entity,
  readOnly,
  selected,
  onSelect,
  onConfirm,
  onDelete,
  editor,
}: {
  entity: Entity;
  readOnly: boolean;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onDelete: () => void;
  /** Rendered directly under this callout's header when it's selected. */
  editor: React.ReactNode;
}) {
  const suggested = entity.status === "suggested";
  const warned = entity.warnings.length > 0;
  const cardRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (selected) {
      setCollapsed(false);
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);

  return (
    <div
      ref={cardRef}
      id={`entity-item-${entity.id}`}
      className={
        "callout" +
        (selected ? " callout--selected" : "") +
        (suggested ? " callout--suggested" : "") +
        (warned ? " callout--warn" : "")
      }
    >
      <div className="callout__header">
        <div
          className="callout__header-main"
          onClick={onSelect}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect();
            }
          }}
        >
          <div className="callout__title-row">
            <span className="callout__text">
              {entity.text ? entity.text : <span className="callout__empty">Unlabeled callout</span>}
            </span>
            <div className="callout__badges">
              {suggested && <span className="badge badge--suggested">suggested</span>}
              {warned && (
                <span className="badge badge--warn" title={entity.warnings.join(", ")}>
                  <IconAlertTriangle size={11} /> check
                </span>
              )}
            </div>
          </div>
          <div className="callout__meta">{kindLabel(entity)}</div>
        </div>

        <div className="callout__header-actions">
          {!readOnly && !selected && suggested && (
            <button
              type="button"
              className="btn btn--small btn--ok btn--confirm-quick"
              title="Confirm suggestion"
              onClick={(e) => {
                e.stopPropagation();
                onConfirm();
              }}
            >
              <IconCheck size={12} /> Confirm
            </button>
          )}
          {!readOnly && !selected && (
            <button
              type="button"
              className="btn btn--ghost btn--small btn--icon-only btn--delete-quick"
              title="Delete callout"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <IconTrash size={13} />
            </button>
          )}
          <button
            type="button"
            className={"callout__toggle" + (collapsed ? " callout__toggle--collapsed" : "")}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand callout" : "Collapse callout"}
            title={collapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed((c) => !c);
            }}
          >
            <IconChevronDown size={14} />
          </button>
        </div>
      </div>

      {!collapsed && selected && editor}
    </div>
  );
}

/** Symbols a drafter types into a callout, grouped as the sheet uses them. */
const DIMENSION_SYMBOLS = [
  { s: "⌀", label: "Diameter" },
  { s: "±", label: "Plus-minus" },
  { s: "°", label: "Degree" },
  { s: "×", label: "Times (chamfer 1×45°)" },
  { s: "R", label: "Radius" },
  { s: "▽", label: "Thread depth" },
  { s: "↧", label: "Depth" },
  { s: "⌴", label: "Counterbore" },
  { s: "⌵", label: "Countersink" },
  { s: "□", label: "Square" },
];

const GDT_SYMBOLS = [
  { s: "⌖", label: "Position" },
  { s: "⏤", label: "Straightness" },
  { s: "⏥", label: "Flatness" },
  { s: "○", label: "Circularity" },
  { s: "⌭", label: "Cylindricity" },
  { s: "⊥", label: "Perpendicularity" },
  { s: "∥", label: "Parallelism" },
  { s: "∠", label: "Angularity" },
  { s: "⌒", label: "Profile of a line" },
  { s: "⌓", label: "Profile of a surface" },
  { s: "◎", label: "Concentricity" },
  { s: "≡", label: "Symmetry" },
  { s: "↗", label: "Circular runout" },
  { s: "⌰", label: "Total runout" },
];

const SYMBOL_ROW_KEY = "glypad.symbolRow.visible";

/** Whether the symbol row is shown. Stored per browser; falls back to shown if storage is unavailable. */
function readSymbolRowPreference(): boolean {
  try {
    return window.localStorage.getItem(SYMBOL_ROW_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function writeSymbolRowPreference(visible: boolean) {
  try {
    window.localStorage.setItem(SYMBOL_ROW_KEY, visible ? "shown" : "hidden");
  } catch {
    // Storage blocked (private window, etc.): the choice just won't persist.
  }
}

/** The one place a callout is edited: its text, kind and subtype. The
 * parsed values are shown below the text, read-only. */
function EntityInspector({
  entity,
  readOnly,
  onChange,
  onDelete,
}: {
  entity: Entity;
  readOnly: boolean;
  onChange: (patch: EntityPatch) => void;
  onDelete: () => void;
}) {
  const subtypes = SUBTYPE_LABELS[entity.kind] ?? {};
  const hasSubtypes = Object.keys(subtypes).length > 0;
  const textRef = useRef<HTMLInputElement>(null);
  const [showSymbols, setShowSymbols] = useState(readSymbolRowPreference);
  const [showGdt, setShowGdt] = useState(false);

  /** Puts a symbol into the text field at the cursor, replacing any selection. */
  function insertSymbol(symbol: string) {
    const el = textRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.value = el.value.slice(0, start) + symbol + el.value.slice(end);
    const caret = start + symbol.length;
    el.setSelectionRange(caret, caret);
    el.focus();
  }

  function symbolButton({ s, label }: { s: string; label: string }) {
    return (
      <button
        key={s}
        type="button"
        className="symbol-btn"
        title={label}
        aria-label={`Insert ${label}`}
        // Keep focus in the text field, so the field doesn't save half-typed text on blur.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertSymbol(s)}
      >
        {s}
      </button>
    );
  }

  return (
    <div className="entity-inspector">
      <div className="field">
        <div className="field__head">
          <label>Text on sheet</label>
          {!readOnly && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setShowSymbols((v) => {
                  writeSymbolRowPreference(!v);
                  return !v;
                });
              }}
            >
              {showSymbols ? "hide symbols" : "show symbols"}
            </button>
          )}
        </div>
        <input
          ref={textRef}
          key={`${entity.id}:text:${entity.text ?? ""}`}
          className="input input--mono"
          disabled={readOnly}
          placeholder="e.g. ⌀12.5 ±0.1"
          defaultValue={entity.text ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          onBlur={(e) => {
            const next = e.target.value.trim() || null;
            if (next !== (entity.text ?? null)) onChange({ text: next });
          }}
        />
        {!readOnly && showSymbols && (
          <div className="symbol-row">
            {DIMENSION_SYMBOLS.map(symbolButton)}
            <button
              type="button"
              className={"symbol-btn symbol-btn--more" + (showGdt ? " symbol-btn--open" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowGdt((v) => !v)}
              title="GD&T symbols"
            >
              GD&amp;T {showGdt ? "▴" : "▾"}
            </button>
            {showGdt && <div className="symbol-row__gdt">{GDT_SYMBOLS.map(symbolButton)}</div>}
          </div>
        )}
        {entity.raw_text && entity.raw_text !== entity.text && <span className="hint">Read as: {entity.raw_text}</span>}
        {entity.warnings.map((w) => (
          <span key={w} className="entity-warning">
            <IconAlertTriangle size={12} /> {w}
          </span>
        ))}
      </div>

      <div className="field-grid">
        <div className="field">
          <label>Kind</label>
          <div className="select-wrap">
            <select
              className="input input--select"
              disabled={readOnly}
              value={entity.kind}
              onChange={(e) => onChange({ kind: e.target.value as EntityKind, subtype: null })}
            >
              {ENTITY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <IconChevronDown size={14} className="select-arrow" />
          </div>
        </div>

        {hasSubtypes && (
          <div className="field">
            <label>Type</label>
            <div className="select-wrap">
              <select
                className="input input--select"
                disabled={readOnly}
                value={entity.subtype ?? ""}
                onChange={(e) => onChange({ subtype: e.target.value || null })}
              >
                <option value="">— not set —</option>
                {Object.entries(subtypes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <IconChevronDown size={14} className="select-arrow" />
            </div>
          </div>
        )}
      </div>

      <div className="field">
        <label>Read from text</label>
        <ParsedChips parsed={entity.parsed} />
      </div>

      {!readOnly && (
        <div className="entity-inspector__footer">
          {entity.status === "suggested" ? (
            <button type="button" className="btn btn--small btn--ok" onClick={() => onChange({ status: "confirmed" })}>
              <IconCheck size={13} /> Confirm suggestion
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            className="btn btn--small btn--danger-subtle"
            onClick={onDelete}
            title="Delete this callout (Delete key)"
          >
            <IconTrash size={13} /> Delete callout
          </button>
        </div>
      )}
    </div>
  );
}

function ParsedChips({ parsed }: { parsed: ParsedValues }) {
  const chips: string[] = [];
  if (parsed.quantity) chips.push(`${parsed.quantity}×`);
  if (parsed.is_diameter) chips.push("⌀");
  if (parsed.value !== undefined) chips.push(String(parsed.value));
  if (parsed.tolerance_plus !== undefined) {
    const plus = parsed.tolerance_plus;
    const minus = parsed.tolerance_minus ?? plus;
    chips.push(plus === minus ? `±${plus}` : `+${plus} / -${minus}`);
  }
  if (parsed.thread) chips.push(parsed.thread);
  if (parsed.fit_code) chips.push(parsed.fit_code);
  if (parsed.is_reference) chips.push("REF");
  if (parsed.is_basic) chips.push("BASIC");
  if (chips.length === 0) return <span className="hint">Nothing read yet. Type text above.</span>;
  return (
    <div className="parsed-chips">
      {chips.map((c) => (
        <span key={c} className="parsed-chip">
          {c}
        </span>
      ))}
    </div>
  );
}
