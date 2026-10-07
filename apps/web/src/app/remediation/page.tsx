"use client";
import { useEffect, useState } from "react";
import { GovernanceInfo, useCurrentUser } from "../current-user";

type Remediation = {
  id: string;
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  vendor: { legalName: string } | null;
  aiRisk: { title: string } | null;
  governanceFinding: {
    id: string;
    title: string;
    status: string;
    aiControlTest: { aiSystemControl: { id: string; aiSystem: { name: string } } } | null;
  } | null;
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#3b82f6",
  IN_PROGRESS: "#eab308",
  PENDING_VERIFICATION: "#a855f7",
  OVERDUE: "#ef4444",
  CLOSED: "#22c55e",
};
// Legacy vendor / AI-risk remediation keeps its existing status options.
const LEGACY_STATUSES = ["OPEN", "IN_PROGRESS", "OVERDUE", "CLOSED"];

function sourceLabel(item: Remediation): string {
  if (item.vendor) {
    return item.vendor.legalName;
  }
  if (item.governanceFinding) {
    const system = item.governanceFinding.aiControlTest?.aiSystemControl.aiSystem.name;
    return "AI Finding: " + item.governanceFinding.title + (system ? " (" + system + ")" : "");
  }
  if (item.aiRisk) {
    return "AI risk: " + item.aiRisk.title;
  }
  return "Unlinked";
}

export default function RemediationTrackerPage() {
  const [items, setItems] = useState<Remediation[]>([]);
  const [loading, setLoading] = useState(true);
  const { can, loading: userLoading } = useCurrentUser();

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
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Remediation</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {openCount} open of {items.length} total actions across your portfolio
      </p>

      {!userLoading && !can("remediation:read") ? (
        <GovernanceInfo>Remediation tracking requires remediation read permission.</GovernanceInfo>
      ) : loading ? (
        <p style={{ color: "#8b96ac" }}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>No remediation actions yet. Add one from a vendor detail page or from an AI Finding.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const color = STATUS_COLORS[item.status] ?? "#8b96ac";
            const governed = item.governanceFinding !== null;
            const overdue = governed && item.dueDate !== null && new Date(item.dueDate).getTime() < Date.now() && item.status !== "CLOSED";
            const controlId = item.governanceFinding?.aiControlTest?.aiSystemControl.id;
            return (
              <div key={item.id} style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {item.title} <span style={{ color: "#5d6786", fontWeight: 400 }}>&mdash; {sourceLabel(item)}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#8b96ac", margin: "4px 0" }}>{item.description}</p>
                    {item.dueDate && (
                      <div style={{ fontSize: 11.5, color: overdue ? "#ef4444" : "#5d6786" }}>
                        Due {new Date(item.dueDate).toLocaleDateString(undefined, { timeZone: "UTC" })}
                        {overdue ? " - overdue" : ""}
                      </div>
                    )}
                    {governed && controlId && (
                      <a href={`/ai-system-controls/${controlId}/evidence`} style={{ fontSize: 12, color: "#93c5fd", textDecoration: "none" }}>
                        {"Manage in the Finding (submit and independent verification) ->"}
                      </a>
                    )}
                  </div>
                  {governed ? (
                    <span
                      style={{
                        color,
                        border: `1px solid ${color}`,
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 11.5,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.status.replace(/_/g, " ")}
                    </span>
                  ) : (
                    <select
                      value={item.status}
                      disabled={!can("remediation:update")}
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
                      {LEGACY_STATUSES.map((s) => (
                        <option key={s} value={s} style={{ color: "#000" }}>
                          {s.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}