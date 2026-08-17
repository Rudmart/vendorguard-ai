"use client";
import { useEffect, useState } from "react";

type Remediation = {
  id: string;
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  vendor: { legalName: string };
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#3b82f6",
  IN_PROGRESS: "#eab308",
  OVERDUE: "#ef4444",
  CLOSED: "#22c55e",
};

export default function RemediationTrackerPage() {
  const [items, setItems] = useState<Remediation[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/remediations`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setItems(data.remediations);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateStatus(id: string, status: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/remediations/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await load();
  }

  const openCount = items.filter((i) => i.status !== "CLOSED").length;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Remediation Tracker</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {openCount} open of {items.length} total actions across your portfolio
      </p>

      {loading ? (
        <p style={{ color: "#8b96ac" }}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>
          No remediation actions yet. Add one from a vendor&apos;s detail page.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const color = STATUS_COLORS[item.status];
            return (
              <div
                key={item.id}
                style={{
                  background: "#1a2340",
                  border: "1px solid #2e3d63",
                  borderRadius: 10,
                  padding: "14px 18px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {item.title} <span style={{ color: "#5d6786", fontWeight: 400 }}>&mdash; {item.vendor.legalName}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#8b96ac", margin: "4px 0" }}>{item.description}</p>
                    {item.dueDate && (
                      <div style={{ fontSize: 11.5, color: "#5d6786" }}>
                        Due {new Date(item.dueDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  <select
                    value={item.status}
                    onChange={(e) => updateStatus(item.id, e.target.value)}
                    style={{
                      background: "#141b2d",
                      color,
                      border: `1px solid ${color}`,
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {Object.keys(STATUS_COLORS).map((s) => (
                      <option key={s} value={s} style={{ color: "#000" }}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
