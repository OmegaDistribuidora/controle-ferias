import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiJson, setUnauthorizedHandler } from "../services/api";

const STORAGE_KEY = "controle-ferias-auth";
const AuthContext = createContext(null);

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch (error) {
    return { token: null, user: null };
  }
}

function readSsoTokenFromHash() {
  try {
    const hash = String(window.location.hash || "").replace(/^#/, "");
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get("sso");
  } catch (error) {
    return null;
  }
}

function clearSsoHash() {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}`);
}

function getTokenExpiration(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;

    const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = normalizedPayload.padEnd(Math.ceil(normalizedPayload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(paddedPayload));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch (error) {
    return null;
  }
}

export function AuthProvider({ children }) {
  const initial = readStorage();
  const initialSsoToken = readSsoTokenFromHash();
  const [token, setToken] = useState(initial.token || null);
  const [user, setUser] = useState(initial.user || null);
  const [loading, setLoading] = useState(Boolean(initialSsoToken || (initial.token && !initial.user)));
  const [ssoError, setSsoError] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  }, [token, user]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      setSsoError("");
    });

    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  useEffect(() => {
    const ssoToken = readSsoTokenFromHash();
    if (token || !ssoToken) {
      return undefined;
    }

    let active = true;
    setLoading(true);
    setSsoError("");

    apiJson("/auth/sso/exchange", {
      method: "POST",
      data: { token: ssoToken },
    })
      .then((payload) => {
        if (!active) return;
        setToken(payload.token);
        setUser(payload.user);
      })
      .catch((error) => {
        if (!active) return;
        setToken(null);
        setUser(null);
        setSsoError(error.message || "Falha ao validar login vindo do Ecossistema.");
      })
      .finally(() => {
        clearSsoHash();
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    const pendingSsoToken = readSsoTokenFromHash();
    if (!token || user) {
      if (pendingSsoToken && !token) {
        return undefined;
      }
      setLoading(false);
      return;
    }

    let active = true;
    apiJson("/auth/me", { token })
      .then((payload) => {
        if (active) {
          setUser(payload.user);
        }
      })
      .catch(() => {
        if (active) {
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, user]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const expirationTime = getTokenExpiration(token);
    if (!expirationTime) {
      return undefined;
    }

    const timeoutMs = expirationTime - Date.now();
    if (timeoutMs <= 0) {
      setToken(null);
      setUser(null);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToken(null);
      setUser(null);
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [token]);

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      ssoError,
      isAuthenticated: Boolean(token && user),
      async login(username, password) {
        setSsoError("");
        const payload = await apiJson("/auth/login", {
          method: "POST",
          data: { username, password },
        });
        setToken(payload.token);
        setUser(payload.user);
      },
      logout() {
        setToken(null);
        setUser(null);
        setSsoError("");
      },
    }),
    [token, user, loading, ssoError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  }
  return context;
}
