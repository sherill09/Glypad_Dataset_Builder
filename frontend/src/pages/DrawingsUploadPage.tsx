import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError, listDrawings, uploadDrawing } from "../api/client";
import { UploadDropzone } from "../components/UploadDropzone";
import { useStudio } from "../context/StudioContext";
import type { DrawingOut, DrawingUploadResult } from "../types/drawing";

export function DrawingsUploadPage() {
  const [drawings, setDrawings] = useState<DrawingOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<DrawingUploadResult | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "draft">("all");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const navigate = useNavigate();
  const { setStudio } = useStudio();

  async function refresh() {
    try {
      const data = await listDrawings();
      setDrawings(data);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFiles(files: File[]) {
    setUploading(true);
    setError(null);
    setLastResult(null);
    try {
      let lastUploadedVersionId: string | null = null;
      let lastUploadedFilename: string | null = null;
      for (const file of files) {
        const result = await uploadDrawing(file);
        setLastResult(result);
        const targetVersion =
          result.drawing.annotation_versions.find((v) => v.is_current) ??
          result.drawing.annotation_versions[0];
        if (targetVersion) {
          lastUploadedVersionId = targetVersion.id;
          lastUploadedFilename = result.drawing.original_filename;
        }
      }
      if (lastUploadedVersionId && lastUploadedFilename) {
        setStudio(lastUploadedVersionId, lastUploadedFilename);
      }
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setUploading(false);
    }
  }

  // Summary Metrics
  const totalDrawings = drawings.length;
  const approvedCount = drawings.filter((d) => {
    const current = d.annotation_versions.find((v) => v.is_current) ?? d.annotation_versions[0];
    return current?.status === "approved";
  }).length;
  const draftCount = totalDrawings - approvedCount;
  const totalVersions = drawings.reduce((acc, d) => acc + (d.version_count ?? d.annotation_versions.length), 0);

  // Available Formats
  const availableFormats = useMemo(() => {
    const set = new Set<string>();
    drawings.forEach((d) => set.add(d.format.toLowerCase()));
    return Array.from(set).sort();
  }, [drawings]);

  // Filtered List
  const filteredDrawings = useMemo(() => {
    return drawings.filter((d) => {
      const current = d.annotation_versions.find((v) => v.is_current) ?? d.annotation_versions[0];
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        d.original_filename.toLowerCase().includes(q) ||
        (d.first_uploaded_by_email && d.first_uploaded_by_email.toLowerCase().includes(q));

      const matchesStatus =
        statusFilter === "all" || (current && current.status === statusFilter);

      const matchesFormat =
        formatFilter === "all" || d.format.toLowerCase() === formatFilter.toLowerCase();

      return matchesSearch && matchesStatus && matchesFormat;
    });
  }, [drawings, searchQuery, statusFilter, formatFilter]);

  function renderLayerTags(d: DrawingOut) {
    const pageCount = d.page_count ?? 1;

    // Geometry status
    let geoTag = null;
    if (d.has_vector_geo && d.has_raster_geo) {
      geoTag = (
        <span
          className="layer-tag layer-tag--hybrid"
          title="Contains both vector CAD geometry paths and embedded raster bitmap imagery"
        >
          Vector + Raster Geo
        </span>
      );
    } else if (d.has_vector_geo) {
      geoTag = (
        <span
          className="layer-tag layer-tag--vector"
          title="Pure vector CAD drawing geometry paths"
        >
          Vector Geo
        </span>
      );
    } else if (d.has_raster_geo) {
      geoTag = (
        <span
          className="layer-tag layer-tag--raster"
          title="Rasterized bitmap drawing graphics"
        >
          Raster Geo
        </span>
      );
    }

    // Text status
    let textTag = null;
    if (d.has_vector_text && d.has_raster_text) {
      textTag = (
        <span
          className="layer-tag layer-tag--hybrid"
          title="Contains both native digital vector text and rasterized scanned text"
        >
          Vector + Raster Text
        </span>
      );
    } else if (d.has_vector_text) {
      textTag = (
        <span
          className="layer-tag layer-tag--vector"
          title="Native digital vector font / text layer"
        >
          Vector Text
        </span>
      );
    } else if (d.has_raster_text) {
      textTag = (
        <span
          className="layer-tag layer-tag--raster"
          title="Rasterized or scanned pixel text"
        >
          Raster Text
        </span>
      );
    } else {
      textTag = (
        <span
          className="layer-tag layer-tag--none"
          title="No text layer detected in drawing"
        >
          No Text
        </span>
      );
    }

    return (
      <div className="drawing-layers-row">
        <span className="layer-tag layer-tag--pages" title={`${pageCount} page(s) in sheet`}>
          {pageCount} {pageCount === 1 ? "Page" : "Pages"}
        </span>
        {geoTag}
        {textTag}
      </div>
    );
  }

  function getFormatBadge(format: string) {
    const f = format.toLowerCase();
    if (f === "pdf") return <span className="fmt-pill fmt-pill--pdf">PDF</span>;
    if (f === "dxf") return <span className="fmt-pill fmt-pill--dxf">DXF</span>;
    if (f === "svg") return <span className="fmt-pill fmt-pill--svg">SVG</span>;
    if (f === "png" || f === "jpg" || f === "jpeg" || f === "tiff") {
      return <span className="fmt-pill fmt-pill--img">{f.toUpperCase()}</span>;
    }
    return <span className="fmt-pill fmt-pill--3d">{format.toUpperCase()}</span>;
  }

  return (
    <div className="page page--wide">
      {/* Page Header */}
      <div className="repo-header">
        <div className="repo-header__main">
          <div className="repo-header__badge">
            <span className="repo-header__badge-dot" />
            CAD Vision Dataset Pipeline
          </div>
          <h1 className="repo-header__title">Drawing Repository</h1>
          <p className="repo-header__subtitle">
            Upload, inspect, and annotate engineering drawing sheets to generate structured datasets for CAD AI vision models.
          </p>
        </div>
        <div className="repo-header__actions">
          <Link to="/export" className="btn btn--secondary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2 2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Dataset Releases & Export
          </Link>
        </div>
      </div>

      {/* Stats KPI Ribbon */}
      <div className="stats-ribbon">
        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--blue">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div className="stat-card__info">
            <span className="stat-card__value">{totalDrawings}</span>
            <span className="stat-card__label">Total Drawing Sheets</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--green">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="stat-card__info">
            <span className="stat-card__value">{approvedCount}</span>
            <span className="stat-card__label">Approved for Export</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--amber">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="stat-card__info">
            <span className="stat-card__value">{draftCount}</span>
            <span className="stat-card__label">Drafts in Progress</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card__icon stat-card__icon--purple">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <div className="stat-card__info">
            <span className="stat-card__value">{totalVersions}</span>
            <span className="stat-card__label">Annotation Versions</span>
          </div>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Modern Upload Dropzone */}
      <UploadDropzone onFilesSelected={handleFiles} disabled={uploading} />

      {/* Upload & Deduplication Feedback Banner */}
      {lastResult && (
        <div className={`result-card ${lastResult.created ? "result-card--success" : "result-card--dedup"}`}>
          <div className="result-card__header">
            <div className="result-card__title">
              {lastResult.created ? (
                <>
                  <span className="result-card__dot result-card__dot--green" />
                  New Drawing Uploaded: <strong>{lastResult.drawing.original_filename}</strong>
                </>
              ) : (
                <>
                  <span className="result-card__dot result-card__dot--amber" />
                  Exact Content Already Exists (Deduplicated): <strong>{lastResult.drawing.original_filename}</strong>
                </>
              )}
            </div>
            {lastResult.created && lastResult.drawing.annotation_versions[0] && (
              <Link
                to={`/annotation-versions/${lastResult.drawing.annotation_versions[0].id}`}
                className="btn btn--primary btn--small"
              >
                Open Studio →
              </Link>
            )}
          </div>

          <div className="result-card__body">
            {lastResult.created ? (
              <>
                <p className="result-card__text">
                  Created version 1 (draft). Ready for Layer 1 drawing setup and region annotation.
                </p>
                <div style={{ marginTop: 8 }}>
                  {renderLayerTags(lastResult.drawing)}
                </div>
              </>
            ) : (
              <div>
                <p className="result-card__text">
                  This exact file content matches an existing record in the repository with {lastResult.drawing.annotation_versions.length} annotation version(s):
                </p>
                <div style={{ margin: "6px 0 10px 0" }}>
                  {renderLayerTags(lastResult.drawing)}
                </div>
                <div className="result-card__version-list">
                  {lastResult.drawing.annotation_versions.map((v) => (
                    <div key={v.id} className="version-chip">
                      <span className="version-chip__num">v{v.version_number}</span>
                      <span className={`badge badge--status-${v.status}`}>{v.status}</span>
                      {v.is_current && <span className="version-chip__current">Current</span>}
                      <span className="version-chip__meta">by {v.created_by_email ?? "user"}</span>
                      <Link to={`/annotation-versions/${v.id}`} className="version-chip__link">
                        Open Studio →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="repo-toolbar">
        <div className="search-box">
          <svg className="search-box__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className="search-box__input"
            placeholder="Search by drawing name or uploader…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" className="search-box__clear" onClick={() => setSearchQuery("")}>
              ✕
            </button>
          )}
        </div>

        <div className="repo-toolbar__filters">
          <div className="filter-group">
            <button
              type="button"
              className={`filter-btn ${statusFilter === "all" ? "filter-btn--active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`filter-btn ${statusFilter === "approved" ? "filter-btn--active" : ""}`}
              onClick={() => setStatusFilter("approved")}
            >
              Approved
            </button>
            <button
              type="button"
              className={`filter-btn ${statusFilter === "draft" ? "filter-btn--active" : ""}`}
              onClick={() => setStatusFilter("draft")}
            >
              Drafts
            </button>
          </div>

          {availableFormats.length > 1 && (
            <select
              className="select-filter"
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
            >
              <option value="all">All Formats ({drawings.length})</option>
              {availableFormats.map((fmt) => (
                <option key={fmt} value={fmt}>
                  {fmt.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main Drawings Vault Table */}
      {loading ? (
        <div className="empty-state">
          <div className="spinner" />
          <p className="hint">Loading CAD drawing repository…</p>
        </div>
      ) : filteredDrawings.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </div>
          <h3 className="empty-state__title">
            {searchQuery || statusFilter !== "all" || formatFilter !== "all"
              ? "No drawings match your filter criteria"
              : "No CAD drawings uploaded yet"}
          </h3>
          <p className="empty-state__subtitle">
            {searchQuery || statusFilter !== "all" || formatFilter !== "all"
              ? "Try adjusting your search terms or clearing active filters."
              : "Drag and drop PDF or DXF drawing sheets above to begin building your CAD dataset."}
          </p>
        </div>
      ) : (
        <div className="table-responsive repo-table-wrap">
          <table className="file-table repo-table">
            <thead>
              <tr>
                <th>Drawing Sheet</th>
                <th>Format</th>
                <th>Discipline</th>
                <th>Versions</th>
                <th>Current Status</th>
                <th>Uploaded By</th>
                <th className="repo-table__th-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrawings.map((d) => {
                const current = d.annotation_versions.find((v) => v.is_current) ?? d.annotation_versions[0];
                const totalVers = d.version_count ?? d.annotation_versions.length;
                return (
                  <tr
                    key={d.id}
                    className="file-row repo-row"
                    onClick={() => {
                      if (current) {
                        setStudio(current.id, d.original_filename);
                        navigate(`/annotation-versions/${current.id}`);
                      }
                    }}
                  >
                    {/* File Name & Icon */}
                    <td className="repo-col-name">
                      <div className="drawing-cell">
                        <div className="drawing-cell__icon">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div className="drawing-cell__content">
                          <span className="drawing-cell__filename" title={d.original_filename}>
                            {d.original_filename}
                          </span>
                          {renderLayerTags(d)}
                        </div>
                      </div>
                    </td>

                    {/* Format Pill */}
                    <td>{getFormatBadge(d.format)}</td>

                    {/* Discipline */}
                    <td>
                      <span className="discipline-tag">{d.category.toUpperCase()}</span>
                    </td>

                    {/* Version Count */}
                    <td>
                      <div className="versions-pill" title={`${totalVers} total version(s)`}>
                        <span className="versions-pill__active">v{current?.version_number ?? 1}</span>
                        {totalVers > 1 && (
                          <span className="versions-pill__count">({totalVers} total)</span>
                        )}
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td>
                      {current ? (
                        <span className={`badge badge--status-${current.status} repo-badge`}>
                          <span className="badge__dot" />
                          {current.status}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>

                    {/* Uploader */}
                    <td>
                      <span className="uploader-text" title={d.first_uploaded_by_email ?? undefined}>
                        {d.first_uploaded_by_email ?? "—"}
                      </span>
                    </td>

                    {/* Action Button */}
                    <td className="repo-table__td-action">
                      {current && (
                        <Link
                          to={`/annotation-versions/${current.id}`}
                          className="btn btn--primary btn--small repo-open-btn"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Open Studio
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
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
