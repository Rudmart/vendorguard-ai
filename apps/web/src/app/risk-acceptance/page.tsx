"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type UserRef = { id: string; displayName: string; email: string };
type Row = {
  id: string;
  state: string;
  expiresAt: string | null;
  residualScoreAtRequest: number | null;
  residualRatingAtRequest: string | null;
  createdAt: string;
  requestedBy: UserRef | null;
  decidedBy: UserRef | null;
  governanceFinding: { id: string; title: string; status: string } | null;
  aiRisk: { id: string; title: string; treatmentOwner: UserRef | null; assessment: { aiSystem: { id: string; name: string } } } | null;
};

const STATE_LABEL: Record<string, string> = { PENDING_REVIEW: "Pending Review", ACTIVE: "Approved - Active", EXPIRED: "Approved - Expired", REJECTED: "Rejected" };
const STATE_COLOR: Record<string, string> = { PENDING_REVIEW: "#fbbf24", ACTIVE: "#4ade80", EXPIRED: "#94a3b8", REJECTED: "#f87171" };

const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 12 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not set";
}

export default function RiskAcceptancePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/risk-acceptances`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setRows(((await res.json()) as { riskAcceptances: Row[] }).riskAcceptances);
      })
      .catch(() => setError("Could not load Risk Acceptance"));
  }, []);

  return (
    <main style={{ padding: 24, color: "#e5e7eb", maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, margin: "0 0 6px 0" }}>Risk Acceptance</h1>
      <p style={muted}>
        Risk Acceptance is an authorized human decision to tolerate the residual risk of an AI risk for a defined period, under documented conditions. An accepted
        risk is still a risk - it stays in every risk view. Accepting a risk never closes a Finding; only verified remediation does.
      </p>
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}
      {rows && rows.length === 0 && <p style={muted}>No Risk Acceptance requests yet. Start one from a risk in an AI risk assessment.</p>}
      {rows?.map((r) =>
        r.aiRisk ? (
          <div key={r.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <a href={"/risk-acceptance/" + r.aiRisk.id} style={{ color: "#e5e7eb", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
                {r.aiRisk.title}
              </a>
              <span style={{ border: "1px solid " + (STATE_COLOR[r.state] ?? "#94a3b8"), color: STATE_COLOR[r.state] ?? "#94a3b8", borderRadius: 999, padding: "2px 10px", fontSize: 12 }}>
                {STATE_LABEL[r.state] ?? r.state}
              </span>
            </div>
            <p style={muted}>
              AI system: {r.aiRisk.assessment.aiSystem.name} | Risk owner: {r.aiRisk.treatmentOwner ? r.aiRisk.treatmentOwner.displayName : "Not assigned"} | Residual
              risk at request: {r.residualScoreAtRequest ?? "-"} ({r.residualRatingAtRequest ?? "-"})
            </p>
            <p style={muted}>
              Requested by {r.requestedBy ? r.requestedBy.displayName : "-"} on {formatDate(r.createdAt)} | Decided by {r.decidedBy ? r.decidedBy.displayName : "-"} |
              Expires {formatDate(r.expiresAt)}
              {r.governanceFinding ? " | Related Finding: " + r.governanceFinding.title + " (" + r.governanceFinding.status + ")" : ""}
            </p>
          </div>
        ) : null,
      )}
    </main>
  );
}