"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  ROLES,
  roleHasPermission,
  type Role,
} from "@vendorguard/shared/domain";

const API = process.env.NEXT_PUBLIC_API_URL;

/**
 * D3a - frontend authorization = USER EXPERIENCE ONLY. The backend (resolveSession + requirePermission/hasPermission
 * + separation of duties) remains the security authority; anything shown here is still enforced server-side.
 * The role comes from GET /auth/me, which reports the CURRENT database membership role (PR #92).
 */
export type CurrentUser = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: Role;
};

type CurrentUserContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  /** Same permission catalog as the API (packages/shared/src/domain.ts). Fails closed while loading or logged out. */
  can: (permission: string) => boolean;
};

const CurrentUserContext = createContext<CurrentUserContextValue>({
  user: null,
  loading: true,
  can: () => false,
});

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [retiredContext, setRetiredContext] = useState(false);
  const operationalControlContext =
    /^\/ai-(system-controls|control-tests)\//.test(pathname);
  // Retirement changes UI affordances only; server guards remain authoritative.
  // Incident and remediation pages are deliberately outside this operational mask.
  useEffect(() => {
    let cancelled = false;
    setRetiredContext(false);
    const match = pathname.match(
      /^\/(ai-systems|ai-risk-assessments|ai-impact-assessments|ai-use-cases|ai-system-controls|ai-control-tests)\/([^/]+)/,
    );
    if (!match) return;
    const resource = match[1]!,
      id = match[2]!;
    const read = async (path: string) => {
      const response = await fetch(`${API}${path}`, { credentials: "include" });
      return response.ok ? response.json() : null;
    };
    function systemId(value: unknown, depth = 0): string | null {
      if (!value || typeof value !== "object" || depth > 3) return null;
      const data = value as Record<string, unknown>;
      if (typeof data.aiSystemId === "string") return data.aiSystemId;
      const system = data.aiSystem as { id?: string } | undefined;
      if (typeof system?.id === "string") return system.id;
      for (const key of [
        "assessment",
        "test",
        "record",
        "controlRecord",
        "aiSystemControl",
        "useCase",
      ]) {
        const found = systemId(data[key], depth + 1);
        if (found) return found;
      }
      return null;
    }
    async function inspect() {
      const source =
        resource === "ai-systems"
          ? null
          : await read(
              `/${resource}/${id}${resource === "ai-system-controls" ? "/evidence" : ""}`,
            );
      const parent = resource === "ai-systems" ? id : systemId(source);
      if (!parent) return;
      const system = await read(`/ai-systems/${parent}`);
      if (!cancelled) setRetiredContext(system?.lifecycleStatus === "RETIRED");
    }
    inspect().catch(() => {
      if (!cancelled) setRetiredContext(false);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // Re-read on every navigation so a database role change is reflected without re-login.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then(async (res) => {
        const data = res.ok
          ? ((await res.json()) as { user?: Partial<CurrentUser> })
          : null;
        if (cancelled) {
          return;
        }
        const u = data?.user;
        const validRole =
          typeof u?.role === "string" &&
          (ROLES as readonly string[]).includes(u.role);
        setUser(
          u && validRole && u.userId && u.tenantId ? (u as CurrentUser) : null,
        );
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

  const retiredOperationalPermissions = [
    "ai-system:update",
    "ai-system:link-vendor",
    "ai-risk-assessment:review",
    "ai-impact-assessment:review",
    "ai-use-case:review",
    "ai-control-test:perform",
    "ai-control-evidence:review",
    "ai-monitoring:review",
    "risk:accept",
  ];
  const can = (permission: string) =>
    user !== null &&
    roleHasPermission(user.role, permission) &&
    !(
      retiredContext &&
      (retiredOperationalPermissions.includes(permission) ||
        (operationalControlContext && permission === "evidence:upload"))
    );
  return (
    <CurrentUserContext.Provider value={{ user, loading, can }}>
      {children}
    </CurrentUserContext.Provider>
  );
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
  const allowed =
    (permission ? can(permission) : false) || (anyOf ?? []).some((p) => can(p));
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
