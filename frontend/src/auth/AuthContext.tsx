import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  getMe,
  getToken,
  login as apiLogin,
  registerAccount as apiRegister,
  setToken as persistToken,
  setUnauthorizedHandler,
} from "../api/client";
import type { User } from "../types/auth";

interface AuthState {
  user: User | null;
  /** true only while checking a previously-stored token on first load */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the signed-in user (if any) for the whole app, and keeps it in sync
 * with the access token in localStorage. Wrap the app in this once (see
 * App.tsx) and read it anywhere with useAuth().
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // A 401 from any API call (an expired or otherwise invalid token) calls
  // this to immediately drop the stale session — see api/client.ts.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  // On first load, if a token is already stored from a previous visit,
  // don't just trust it — ask the API who it belongs to. If the token
  // expired or the server's secret changed since then, this clears it
  // instead of leaving the app in a broken half-signed-in state.
  useEffect(() => {
    const existing = getToken();
    if (!existing) {
      setLoading(false);
      return;
    }
    getMe()
      .then(setUser)
      .catch(() => persistToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const res = await apiLogin(email, password);
    persistToken(res.access_token);
    setUser(res.user);
  }

  async function register(email: string, password: string, displayName: string) {
    const res = await apiRegister(email, password, displayName);
    persistToken(res.access_token);
    setUser(res.user);
  }

  function logout() {
    persistToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>");
  return ctx;
}
