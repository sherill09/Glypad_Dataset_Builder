import type { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "./AuthContext";

/**
 * Wraps a page that requires sign-in. If we're still checking a stored
 * token, show nothing alarming yet; once we know there's no signed-in
 * user, bounce to /login (remembering where they were headed, so login can
 * send them back).
 */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className="page">Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}
