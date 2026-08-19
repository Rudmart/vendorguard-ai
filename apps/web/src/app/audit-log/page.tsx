"use client";

import { useEffect, useState } from "react";

type AuditEntry = {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
};

type AuditLogData = {
  entries: AuditEntry[];
};

export default function AuditLogPage() {
  const [data, setData] = useState<AuditLogData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setData({
      entries: [
        {
          id: "1",
          actor: "Ruddy A Martinez",
          action: "Created vendor",
          target: "AI Smoke Test Vendor",
          timestamp: new Date().toISOString(),
        },
      ],
    });
    setLoading(false);
  }, []);

  if (loading) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Loading...</main>;
  }
  if (!data) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Failed to load audit log.</main>;
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Audit Log</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {data.entries.length} recent {data.entries.length === 1 ? "event" : "events"}{" "}
        <span style={{ color: "#5c6780" }}>(placeholder data - API not wired yet)</span>
      </p>

      {data.entries.length === 0 ? (
        <div style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 24, color: "#8b96ac", fontSize: 13.5 }}>
          No audit events recorded yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.entries.map((entry) => (
            <div key={entry.id} style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{entry.actor} - {entry.action}</div>
                <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 2 }}>{entry.target}</div>
              </div>
              <span style={{ fontSize: 11.5, color: "#5c6780" }}>{new Date(entry.timestamp).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
