"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type Check = {
  id: string;
  title: string;
  category: string;
  cadence: string;
  active: boolean;
  nextDueAt: string;
  dueState: string;
  owner: { displayName: string; email: string } | null;
  lastReview: { result: string; reviewedAt: string } | null;
};
type Overview = {
  aiSystem: { lifecycleStatus: string };
  dueSoonDays: number;
  acceptanceExpiringDays: number;
  checks: Check[];
  context: {
    retestsOverdue: { testId: string; control: { controlId: string; title: string }; nextTestDate: string }[];
    expiredEvidence: { id: string; displayFilename: string; expirationDate: string }[];
    openFindings: { id: string; title: string; severity: string; ageDays: number }[];
    overdueRemediation: { id: string; title: string; dueDate: string }[];
    riskAcceptances: { id: string; state: string; expiringSoon: boolean; expiresAt: string | null; aiRisk: { id: string; title: string } | null }[];
    reassessmentsInProgress: { id: string; pastTarget: boolean; targetDate: string | null }[];
  };
};

const CATEGORIES = ["HUMAN_OVERSIGHT", "USE_AND_SCOPE", "OUTCOMES_PERFORMANCE", "FAIRNESS", "COMPLAINTS_FEEDBACK", "CONTROL_OPERATION", "REGULATORY", "OTHER"];
const CADENCES = ["MONTHLY", "QUARTERLY", "SEMIANNUALLY", "ANNUALLY"];
const DUE_COLOR: Record<string, string> = { OVERDUE: "#f87171", DUE_SOON: "#fbbf24", NOT_DUE: "#4ade80", INACTIVE: "#94a3b8" };
const cardStyle: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 };
const field: CSSProperties = { background: "#141b2d", color: "#e6e9f0", border: "1px solid #2e3d63", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box", marginBottom: 8, colorScheme: "dark" };
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer" };
const muted: CSSProperties = { color: "#8b96ac", fontSize: 12.5, margin: "4px 0" };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };
const words = (v: string) => v.replace(/_/g, " ").toLowerCase();

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-";
}

export default function MonitoringCard({ aiSystemId }: { aiSystemId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState({ title: "", whatToReview: "", expectation: "", category: "HUMAN_OVERSIGHT", cadence: "MONTHLY", ownerEmail: "" });

  useEffect(() => {
    fetch(`${API}/ai-systems/${aiSystemId}/monitoring`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setData((await res.json()) as Overview);
      })
      .catch(() => setError("Could not load governance monitoring"));
  }, [aiSystemId, reloadKey]);

  async function addCheck() {
    setBusy(true);
    setError(null);
    const res = await fetch(`${API}/ai-systems/${aiSystemId}/monitoring-checks`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ownerEmail: form.ownerEmail || undefined }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "Could not add the check");
      return;
    }
    setAdding(false);
    setForm({ title: "", whatToReview: "", expectation: "", category: "HUMAN_OVERSIGHT", cadence: "MONTHLY", ownerEmail: "" });
    setReloadKey((k) => k + 1);
  }

  const c = data?.context;
  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Governance Monitoring</div>
      <p style={muted}>
        Governance monitoring - not technical telemetry. Define what must be reviewed, by whom and how often; record human observations and judgments. Concerns
        are escalated to a Reassessment only by an explicit human action. Nothing changes automatically.
      </p>
      {data && <p style={muted}>Lifecycle status: {words(data.aiSystem.lifecycleStatus)}</p>}
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}

      <div style={{ ...muted, fontWeight: 600, marginTop: 12 }}>Monitoring checks</div>
      {data && data.checks.length === 0 && <p style={muted}>No monitoring checks yet.</p>}
      {data?.checks.map((k) => (
        <p key={k.id} style={{ ...muted, margin: "6px 0" }}>
          <a href={`/ai-systems/${aiSystemId}/monitoring/${k.id}`} style={{ color: "#93c5fd", textDecoration: "none" }}>
            {k.title}
          </a>
          {" | " + words(k.category) + " | " + words(k.cadence) + " | owner " + (k.owner?.displayName ?? "-") + " | "}
          <span style={{ color: DUE_COLOR[k.dueState] ?? "#94a3b8" }}>{words(k.dueState) + (k.active ? " (next due " + formatDate(k.nextDueAt) + ")" : "")}</span>
          {k.lastReview ? " | last result: " + words(k.lastReview.result) : " | not reviewed yet"}
        </p>
      ))}
      {!adding ? (
        <button style={{ ...button, marginTop: 6 }} onClick={() => setAdding(true)}>
          Add monitoring check
        </button>
      ) : (
        <div style={{ marginTop: 8 }}>
          <span style={label}>Title</span>
          <input style={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <span style={label}>What to review</span>
          <textarea style={field} rows={2} value={form.whatToReview} onChange={(e) => setForm({ ...form, whatToReview: e.target.value })} />
          <span style={label}>Expectation / acceptable criteria</span>
          <textarea style={field} rows={2} value={form.expectation} onChange={(e) => setForm({ ...form, expectation: e.target.value })} />
          <span style={label}>Category</span>
          <select style={field} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((v) => (
              <option key={v} value={v}>
                {words(v)}
              </option>
            ))}
          </select>
          <span style={label}>Cadence</span>
          <select style={field} value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })}>
            {CADENCES.map((v) => (
              <option key={v} value={v}>
                {words(v)}
              </option>
            ))}
          </select>
          <span style={label}>Owner email (blank = you)</span>
          <input style={field} value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
          <button style={button} disabled={busy || !form.title || !form.whatToReview || !form.expectation} onClick={() => void addCheck()}>
            Save check
          </button>
        </div>
      )}

      {c && (
        <>
          <div style={{ ...muted, fontWeight: 600, marginTop: 16 }}>Governance context (facts VendorGuard already knows)</div>
          <p style={muted}>
            Control retests overdue:{" "}
            {c.retestsOverdue.length === 0 ? "none" : c.retestsOverdue.map((t) => t.control.controlId + " (due " + formatDate(t.nextTestDate) + ")").join("; ")}
          </p>
          <p style={muted}>
            Evidence past its expiration date:{" "}
            {c.expiredEvidence.length === 0 ? "none" : c.expiredEvidence.map((e) => e.displayFilename + " (" + formatDate(e.expirationDate) + ")").join("; ")}
          </p>
          <p style={muted}>
            OPEN Findings: {c.openFindings.length === 0 ? "none" : c.openFindings.map((f) => f.title + " (" + f.severity + ", open " + f.ageDays + " days)").join("; ")}
          </p>
          <p style={muted}>
            Overdue remediation: {c.overdueRemediation.length === 0 ? "none" : c.overdueRemediation.map((r) => r.title + " (due " + formatDate(r.dueDate) + ")").join("; ")}
          </p>
          <p style={muted}>
            Risk Acceptances:{" "}
            {c.riskAcceptances.length === 0
              ? "none"
              : c.riskAcceptances
                  .map((a) => (a.aiRisk?.title ?? "Risk") + " - " + words(a.state) + (a.expiringSoon ? " (expires within " + data?.acceptanceExpiringDays + " days)" : "") + " until " + formatDate(a.expiresAt))
                  .join("; ")}
          </p>
          <p style={muted}>
            Reassessments in progress:{" "}
            {c.reassessmentsInProgress.length === 0 ? "none" : c.reassessmentsInProgress.map((r) => (r.pastTarget ? "past target " + formatDate(r.targetDate) : "on track")).join("; ")}
          </p>
        </>
      )}
    </div>
  );
}