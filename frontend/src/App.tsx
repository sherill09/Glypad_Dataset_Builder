import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useMatch, useNavigate } from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import {
  IconDrawingStudio,
  IconExport,
  IconMenu,
  IconRepository,
  IconX,
} from "./components/Icons";
import { ThemeToggle } from "./components/ThemeToggle";
import { StudioProvider, useStudio } from "./context/StudioContext";
import { AnnotationVersionPage } from "./pages/AnnotationVersionPage";
import { DrawingsUploadPage } from "./pages/DrawingsUploadPage";
import { ExportPage } from "./pages/ExportPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";

function Topbar() {
  const { user, logout } = useAuth();
  const { versionId, drawingName, clearStudio } = useStudio();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Also detect annotation-version route directly (covers hard-navigations
  // before the page has had a chance to register its name in StudioContext).
  const studioMatch = useMatch("/annotation-versions/:versionId");
  const isStudioActive = !!(studioMatch || versionId);
  const studioVersionId = studioMatch?.params?.versionId ?? versionId;
  const studioPath = studioVersionId ? `/annotation-versions/${studioVersionId}` : null;
  const studioFileLabel = drawingName
    ? drawingName.length > 22
      ? drawingName.slice(0, 20) + "…"
      : drawingName
    : null;
  const isOnStudioPage = !!studioMatch;

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <header className="topbar">
      <Link to="/" className="brand-link" style={{ display: "inline-flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
        <span className="brand-mark">GDB</span>
        <span className="brand-title">Glypad Dataset Builder</span>
      </Link>

      {user && (
        <>
          <nav className="topbar-nav desktop-nav">
            <Link
              to="/"
              className={`nav-link ${
                location.pathname === "/" && !isOnStudioPage ? "nav-link--active" : ""
              }`}
            >
              Drawing Repository
            </Link>

            {isStudioActive && studioPath && (
              <div className={`studio-tab-group ${isOnStudioPage ? "studio-tab-group--active" : ""}`}>
                <Link
                  to={studioPath}
                  className={`nav-link nav-link--studio ${isOnStudioPage ? "nav-link--active" : ""}`}
                  title={drawingName ? `Drawing Studio: ${drawingName}` : "Drawing Studio"}
                >
                  <span className="studio-tab-icon"><IconDrawingStudio size={14} /></span>
                  <span>Drawing Studio</span>
                  {studioFileLabel && (
                    <span className="studio-tab-filename">{studioFileLabel}</span>
                  )}
                </Link>
                <button
                  type="button"
                  className="studio-tab-close"
                  title="Close Studio tab"
                  aria-label="Close Studio tab"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearStudio();
                    if (isOnStudioPage) navigate("/");
                  }}
                >
                  <IconX size={12} />
                </button>
              </div>
            )}

            <Link
              to="/export"
              className={`nav-link ${location.pathname.startsWith("/export") ? "nav-link--active" : ""}`}
            >
              Dataset Export
            </Link>
          </nav>

          <div className="spacer desktop-nav" />

          <div className="topbar-user desktop-nav">
            <span className="hint user-name">{user.display_name}</span>
            <ThemeToggle />
            <button type="button" className="btn btn--ghost btn--small" onClick={logout}>
              Log out
            </button>
          </div>

          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? <IconX size={16} /> : <IconMenu size={16} />}
          </button>

          {mobileMenuOpen && (
            <div className="mobile-drawer">
              <nav className="mobile-drawer-links">
                <Link
                  to="/"
                  className={`mobile-nav-link ${
                    location.pathname === "/" && !isOnStudioPage ? "mobile-nav-link--active" : ""
                  }`}
                >
                  <IconRepository size={15} style={{ marginRight: 6, verticalAlign: "middle" }} /> Drawing Repository
                </Link>
                {isStudioActive && studioPath && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <Link
                      to={studioPath}
                      className={`mobile-nav-link ${isOnStudioPage ? "mobile-nav-link--active" : ""}`}
                      style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <IconDrawingStudio size={15} /> Drawing Studio {studioFileLabel ? `(${studioFileLabel})` : ""}
                    </Link>
                    <button
                      type="button"
                      className="studio-tab-close"
                      style={{ marginRight: 12 }}
                      title="Close Drawing Studio"
                      onClick={() => {
                        clearStudio();
                        if (isOnStudioPage) navigate("/");
                      }}
                    >
                      <IconX size={12} />
                    </button>
                  </div>
                )}
                <Link
                  to="/export"
                  className={`mobile-nav-link ${location.pathname.startsWith("/export") ? "mobile-nav-link--active" : ""}`}
                >
                  <IconExport size={15} style={{ marginRight: 6, verticalAlign: "middle" }} /> Dataset Export
                </Link>
              </nav>
              <div className="mobile-drawer-user">
                <div className="hint user-name">{user.display_name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ThemeToggle />
                  <button type="button" className="btn btn--ghost btn--small" onClick={logout}>
                    Log out
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </header>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StudioProvider>
          <div className="app">
            <Topbar />
            <main>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <DrawingsUploadPage />
                    </RequireAuth>
                  }
                />
                {/* Kept as a redirect, not a second route: /drawings was Phase 1's
                    temporary standalone page, now promoted to "/" itself (see
                    PHASE2_IMPLEMENTATION_PLAN.md §6) — this just avoids breaking
                    anyone's existing bookmark to the old path. */}
                <Route path="/drawings" element={<Navigate to="/" replace />} />
                <Route
                  path="/annotation-versions/:versionId"
                  element={
                    <RequireAuth>
                      <AnnotationVersionPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/export"
                  element={
                    <RequireAuth>
                      <ExportPage />
                    </RequireAuth>
                  }
                />
              </Routes>
            </main>
          </div>
        </StudioProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
