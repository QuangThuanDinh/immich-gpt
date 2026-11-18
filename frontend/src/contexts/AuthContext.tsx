import React, { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, logout as apiLogout } from "../services/api";
import { AuthContext, type AuthUser } from "./authContextDef";

export { AuthContext } from "./authContextDef";
export type { AuthUser } from "./authContextDef";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const data = await getCurrentUser(controller.signal);
        if (!controller.signal.aborted) setUser(data);
      } catch {
        if (!controller.signal.aborted) setUser(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await getCurrentUser();
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh, isAdmin: user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}
