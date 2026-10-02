"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

// Alignment Phase B: shared STRUCTURE for global read-only lists (not a visual redesign).
export const API = process.env.NEXT_PUBLIC_API_URL;
export const muted: CSSProperties = { color: "#8b96ac", fontSize: 12.5 };
export const control: CSSProperties = { background: "#141b2d", color: "#e6e9f0", border: "1px solid #2e3d63", borderRadius: 6, padding: "6px 8px", fontSize: 13, marginRight: 8, colorScheme: "dark" };
export const th: CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 12, color: "#8b96ac", borderBottom: "1px solid #2e3d63", whiteSpace: "nowrap" };
export const td: CSSProperties = { padding: "8px 10px", fontSize: 13, borderBottom: "1px solid #1f2a47", verticalAlign: "top" };
export const link: CSSProperties = { color: "#93c5fd", textDecoration: "none" };

export function words(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ").toLowerCase() : "-";
}

export function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-";
}

export function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ border: "1px solid " + color, color, borderRadius: 999, padding: "1px 8px", fontSize: 11.5, whiteSpace: "nowrap" }}>{text}</span>;
}

export function useList<T>(path: string): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    fetch(`${API}${path}`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          throw new Error("Please sign in.");
        }
        if (res.status === 403) {
          throw new Error("Your role cannot view this list.");
        }
        if (!res.ok) {
          throw new Error("Could not load (" + res.status + ").");
        }
        setData((await res.json()) as T);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load."));
  }, [path]);
  return { data, error };
}

export function ListPage({ title, purpose, controls, error, loading, empty, children }: {
  title: string;
  purpose: string;
  controls?: ReactNode;
  error: string | null;
  loading: boolean;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px 0" }}>{title}</h1>
      <p style={{ ...muted, marginTop: 0 }}>{purpose}</p>
      {controls && <div style={{ margin: "12px 0" }}>{controls}</div>}
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}
      {!error && loading && <p style={muted}>Loading...</p>}
      {!error && !loading && empty && <p style={muted}>{empty}</p>}
      {!error && !loading && !empty && <div style={{ overflowX: "auto" }}>{children}</div>}
    </main>
  );
}

export function systemOptions(rows: { aiSystem: { id: string; name: string } | null }[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.aiSystem) {
      map.set(r.aiSystem.id, r.aiSystem.name);
    }
  }
  return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}