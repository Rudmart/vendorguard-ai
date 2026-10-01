"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type Row = {
  id: string;
  reason: string;
  status: string;
  conclusion: string | null;
  materialChange: boolean;
  targetDate: string | null;
  createdAt: string;
  completedAt: string | null;
  pastTarget: boolean;
  initiatedBy: { displayName: string; email: string } | null;
};
type AcceptanceRow = { id: string; state: string; expiresAt: string | null; aiRisk: { title: string; assessment: { aiSystem: { id: string } } } | null };

export const REASON_LABEL: Record<string, string> = {
  PERIODIC_REVIEW: "Periodic review",
  MATERIAL_CHANGE: "Material change",
  REMEDIATION_COMPLETED: "Remediation completed",
  RISK_ACCEPTANCE_REVIEW: "Risk Acceptance review",
  REGULATORY_CHANGE: "Regulatory change",
  OTHER: "Other",
};
const CONCLUSION_LABEL: Record<string, string> = {
  NO_MATERIAL_CHANGE: "No material change",
  GOVERNANCE_UPDATED: "Governance updated",
  FOLLOW_UP_REQUIRED: "Follow-up required",
};

const cardStyle: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 };
const field: CSSProperties = {
  background: "#141b2d",
  color: "#e6e9f0",
  border: "1px solid #2e3d63",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 8,
  colorScheme: "dark",
};
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" };
const muted: CSSProperties = { color: "#8b96ac", fontSize: 12 };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-";
}

export default function ReassessmentsCard({ aiSystemId }: { aiSystemId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [acceptances, setAcceptances] = useState<AcceptanceRow[]>([]);
  const [reason, setReason] = useState("MATERIAL_CHANGE");
  const [whatChanged, setWhatChanged] = useState("");
  const [materialChange, setMaterialChange] = useState(false);
  const [materialDescription, setMaterialDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [acceptanceId, setAcceptanceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/ai-systems/${aiSystemId}/reassessments`, { credentials: "include" })
      .then(async (res) => {
        if (res.ok) {
          setRows(((await res.json()) as { reassessments: Row[] }).reassessments);
        }
      })
      .catch(() => setError("Could not load reassessments"));
    fetch(`${API}/risk-acceptances`, { credentials: "include" })
      .then(async (res) => {
        if (res.ok) {
          const all = ((await res.json()) as { riskAcceptances: AcceptanceRow[] }).riskAcceptances;
          setAcceptances(all.filter((a) => a.aiRisk?.assessment.aiSystem.id === aiSystemId && (a.state === "ACTIVE" || a.state === "EXPIRED")));
        }
      })
      .catch(() => undefined);
  }, [aiSystemId]);

  const open = rows.find((r) => r.status === "IN_PROGRESS") ?? null;

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${API}/ai-systems/${aiSystemId}/reassessments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        whatChanged,
        materialChange,
        materialChangeDescription: materialChange ? materialDescription : undefined,
        targetDate: targetDate || undefined,
        relatedRiskAcceptanceId: reason === "RISK_ACCEPTANCE_REVIEW" && acceptanceId ? acceptanceId : undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not start the reassessment");
      return;
    }
    const created = (await res.json()) as { id: string };
    window.location.href = `/ai-systems/${aiSystemId}/reassessments/${created.id}`;
  }

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Reassessments</div>
      <p style={muted}>
        AI governance is not one-time. When time passes, something changes, remediation completes, or an accepted risk reaches its review date, start a
        reassessment. It keeps the original records and reuses the existing risk, impact, control, evidence, testing, Finding and Risk Acceptance workflows.
      </p>
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}

      {open ? (
        <p style={{ ...muted, color: "#fbbf24" }}>
          A reassessment is in progress.{" "}
          <a href={`/ai-systems/${aiSystemId}/reassessments/${open.id}`} style={{ color: "#93c5fd" }}>
            Continue it
          </a>
        </p>
      ) : (
        <div style={{ marginTop: 8 }}>
          <span style={label}>Reason</span>
          <select style={field} value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(REASON_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <span style={label}>What changed / why reassess</span>
          <textarea
            style={field}
            rows={2}
            placeholder="e.g. Use expands from internal employee support to customer-facing interaction."
            value={whatChanged}
            onChange={(e) => setWhatChanged(e.target.value)}
          />
          <label style={{ ...muted, display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={materialChange} onChange={(e) => setMaterialChange(e.target.checked)} /> This is a material change
          </label>
          {materialChange && (
            <>
              <span style={label}>Why the change matters</span>
              <textarea style={field} rows={2} value={materialDescription} onChange={(e) => setMaterialDescription(e.target.value)} />
            </>
          )}
          {reason === "RISK_ACCEPTANCE_REVIEW" && (
            <>
              <span style={label}>Related Risk Acceptance (context - it will not be renewed or changed)</span>
              <select style={field} value={acceptanceId} onChange={(e) => setAcceptanceId(e.target.value)}>
                <option value="">None</option>
                {acceptances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.aiRisk?.title ?? "Risk") + " - " + a.state + " (expires " + formatDate(a.expiresAt) + ")"}
                  </option>
                ))}
              </select>
            </>
          )}
          <span style={label}>Target completion date (optional)</span>
          <input style={field} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          <button style={button} disabled={busy || !whatChanged} onClick={() => void start()}>
            Start reassessment
          </button>
        </div>
      )}

      <div style={{ ...muted, fontWeight: 600, marginTop: 14 }}>History</div>
      {rows.length === 0 && <p style={muted}>No reassessments yet.</p>}
      {rows.map((r) => (
        <p key={r.id} style={{ ...muted, margin: "6px 0" }}>
          <a href={`/ai-systems/${aiSystemId}/reassessments/${r.id}`} style={{ color: "#93c5fd", textDecoration: "none" }}>
            {formatDate(r.createdAt) + " - " + (REASON_LABEL[r.reason] ?? (r.reason === "MONITORING_REVIEW" ? "Monitoring review" : r.reason))}
          </a>
          {" | " + (r.status === "COMPLETED" ? "Completed: " + (CONCLUSION_LABEL[r.conclusion ?? ""] ?? "-") : "In progress")}
          {r.pastTarget ? " | past target date" : ""}
          {r.initiatedBy ? " | by " + r.initiatedBy.displayName : ""}
        </p>
      ))}
    </div>
  );
}