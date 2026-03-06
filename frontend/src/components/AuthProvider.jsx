import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiJson } from "../services/api";

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

export function AuthProvider({ children }) {
  const initial = readStorage();
  const [token, setToken] = useState(initial.token || null);
  const [user, setUser] = useState(initial.user || null);
  const [loading, setLoading] = useState(Boolean(initial.token && !initial.user));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
  }, [token, user]);

  useEffect(() => {
    if (!token || user) {
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

  const value = useMemo(
    () => ({
      token,
      user,
      loading,
      isAuthenticated: Boolean(token && user),
      async login(username, password) {
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
      },
    }),
    [token, user, loading]
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

