"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

export type TenantUser = { id: string; displayName: string; email: string; role?: string };

/**
 * Owner Pickers: one shared tenant-user picker.
 * Source of truth = GET /tenant-users (current tenant memberships). This list is a convenience only -
 * the API re-validates that the chosen user belongs to the tenant before saving.
 */
export default function TenantUserSelect({
  value,
  onChange,
  emptyLabel = "Select a person",
  style,
  disabled,
}: {
  value: string;
  onChange: (userId: string) => void;
  emptyLabel?: string;
  style?: object;
  disabled?: boolean;
}) {
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/tenant-users`, { credentials: "include" })
      .then(async (res) => {
        if (cancelled) {
          return;
        }
        if (res.status === 403) {
          setError("You do not have permission to assign owners.");
          setUsers([]);
          return;
        }
        if (!res.ok) {
          setError("Could not load people (" + res.status + ").");
          setUsers([]);
          return;
        }
        const data = (await res.json()) as { users?: TenantUser[] };
        if (!cancelled) {
          setUsers(data.users ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the server.");
          setUsers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unknownCurrent = Boolean(value) && users !== null && !users.some((u) => u.id === value);

  return (
    <>
      <select style={style as CSSProperties} value={value} disabled={disabled || users === null} onChange={(e) => onChange(e.target.value)}>
        <option value="">{users === null ? "Loading people..." : emptyLabel}</option>
        {unknownCurrent && <option value={value}>Current owner</option>}
        {(users ?? []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName + " - " + u.email + (u.role ? " (" + u.role + ")" : "")}
          </option>
        ))}
      </select>
      {error && <div style={{ fontSize: 11.5, color: "#fca5a5", marginTop: 4 }}>{error}</div>}
    </>
  );
}