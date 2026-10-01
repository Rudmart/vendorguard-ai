"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type Me = { displayName?: string; email?: string; role?: string };

const menu: CSSProperties = {
  position: "absolute",
  right: 0,
  top: 44,
  background: "#1a2340",
  border: "1px solid #2e3d63",
  borderRadius: 8,
  padding: 12,
  minWidth: 240,
  zIndex: 50,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};
const action: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  color: "#e6e9f0",
  border: "1px solid #2e3d63",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  cursor: "pointer",
  marginTop: 8,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Shows the user who is actually signed in (from /auth/me) and lets them sign out or switch user. */
export default function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${API}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (data && typeof data === "object") {
          const record = data as { user?: Me } & Me;
          setMe(record.user ?? record);
        }
      })
      .catch(() => undefined);
  }, []);

  async function signOut() {
    await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined);
    window.location.href = "/login";
  }

  if (!me || !me.email) {
    return null;
  }
  const name = me.displayName || me.email;
  return (
    <div style={{ position: "relative" }}>
      <button
        aria-label="Signed-in user menu"
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "1px solid #2e3d63", borderRadius: 999, padding: "4px 10px 4px 4px", color: "#e6e9f0", cursor: "pointer" }}
      >
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
          {initials(name)}
        </span>
        <span style={{ fontSize: 12.5 }}>{me.role ?? ""}</span>
      </button>
      {open && (
        <div style={menu}>
          <div style={{ fontSize: 11, color: "#8b96ac" }}>Signed in as</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{name}</div>
          <div style={{ fontSize: 12.5, color: "#8b96ac" }}>{me.email}</div>
          <div style={{ fontSize: 12.5, color: "#8b96ac" }}>Role: {me.role ?? "-"}</div>
          <button style={action} onClick={() => void signOut()}>
            Sign out
          </button>
          <button style={action} onClick={() => void signOut()}>
            Switch user (sign in as someone else)
          </button>
        </div>
      )}
    </div>
  );
}