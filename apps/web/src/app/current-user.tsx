"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ROLES, roleHasPermission, type Role } from "@vendorguard/shared/domain";

const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * D3a - frontend authorization = USER EXPERIENCE ONLY. The backend (resolveSession + requirePermission/hasPermission
 * + separation of duties) remains the security authority; anything shown here is still enforced server-side.
 * The role comes from GET /auth/me, which reports the CURRENT database membership role (PR #92).
 */
export type CurrentUser = { userId: string; tenantId: string; email: string; displayName: string; role: Role };

type CurrentUserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  /** Same permission catalog as the API (packages/shared/src/domain.ts). Fails closed while loading or logged out. */
  can: (permission: string) => boolean;
};

const CurrentUserContext = createContext<CurrentUserContextValue>({ user: null, loading: true, can: () => false });

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-read on every navigation so a database role change is reflected without re-login.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then(async (res) => {
        const data = res.ok ? ((await res.json()) as { user?: Partial<CurrentUser> }) : null;
        if (cancelled) {
          return;
        }
        const u = data?.user;
        const validRole = typeof u?.role === "string" && (ROLES as readonly string[]).includes(u.role);
        setUser(u && validRole && u.userId && u.tenantId ? (u as CurrentUser) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  const can = (permission: string) => user !== null && roleHasPermission(user.role, permission);
  return <CurrentUserContext.Provider value={{ user, loading, can }}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  return useContext(CurrentUserContext);
}

/** Renders children only when the current user's role grants the permission. */
export function Can({
  permission,
  anyOf,
  children,
  fallback = null,
}: {
  permission?: string;
  /** D3b: allowed when the user holds ANY of these permissions (e.g. evidence:read OR evidence:read-metadata). */
  anyOf?: string[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useCurrentUser();
  const allowed = (permission ? can(permission) : false) || (anyOf ?? []).some((p) => can(p));
  return <>{allowed ? children : fallback}</>;
}

/** Non-actionable note for a human governance decision the current user is not authorized to make. */
export function GovernanceInfo({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 12.5,
        color: "#fbbf24",
        background: "#1f1a0e",
        border: "1px solid #78350f",
        borderRadius: 8,
        padding: "8px 12px",
        margin: "8px 0",
      }}
    >
      {children}
    </p>
  );
}