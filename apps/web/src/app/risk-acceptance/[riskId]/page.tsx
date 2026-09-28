"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type UserRef = { id: string; displayName: string; email: string };
type Acceptance = {
  id: string;
  status: string;
  state: string;
  justification: string;
  residualRiskStatement: string | null;
  residualScoreAtRequest: number | null;
  residualRatingAtRequest: string | null;
  conditions: string | null;
  expiresAt: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionRationale: string | null;
  requestedBy: UserRef | null;
  decidedBy: UserRef | null;
  governanceFinding: { id: string; title: string; status: string } | null;
};
type Data = {
  risk: {
    id: string;
    title: string;
    statement: string;
    residualScore: number | null;
    residualRating: string | null;
    treatment: string | null;
    treatmentRationale: string | null;
    treatmentOwner: UserRef | null;
    assessmentId: string;
    aiSystem: { id: string; name: string };
  };
  acceptances: Acceptance[];
  openFindings: { id: string; title: string }[];
};

const STATE_LABEL: Record<string, string> = { PENDING_REVIEW: "Pending Review", ACTIVE: "Approved - Active", EXPIRED: "Approved - Expired", REJECTED: "Rejected" };
const STATE_COLOR: Record<string, string> = { PENDING_REVIEW: "#fbbf24", ACTIVE: "#4ade80", EXPIRED: "#94a3b8", REJECTED: "#f87171" };
const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 };
const field: CSSProperties = {
  background: "#0b1220",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 8,
  colorScheme: "dark",
};
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };
const heading: CSSProperties = { color: "#e5e7eb", fontSize: 15, margin: "0 0 10px 0" };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not set";
}

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Request failed (" + res.status + ")";
}

export default function RiskAcceptanceForRiskPage() {
  const params = useParams();
  const riskId = String(params?.riskId ?? "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [statement, setStatement] = useState("");
  const [justification, setJustification] = useState("");
  const [conditions, setConditions] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [findingId, setFindingId] = useState("");
  const [rationale, setRationale] = useState("");

  useEffect(() => {
    if (!riskId) {
      return;
    }
    fetch(`${API}/ai-risks/${riskId}/risk-acceptance`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setData((await res.json()) as Data);
      })
      .catch(() => setError("Could not load this risk"));
  }, [riskId, reloadKey]);

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const err = await action();
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (err) {
      setError(err);
      return;
    }
    setMessage(success);
    setRationale("");
    setReloadKey((k) => k + 1);
  }

  if (!data) {
    return <main style={{ padding: 24, color: "#e5e7eb" }}>{error ?? "Loading..."}</main>;
  }
  const { risk, acceptances, openFindings } = data;
  const pending = acceptances.find((a) => a.state === "PENDING_REVIEW") ?? null;
  const active = acceptances.find((a) => a.state === "ACTIVE") ?? null;

  return (
    <main style={{ padding: 24, color: "#e5e7eb", maxWidth: 1000 }}>
      <a href="/risk-acceptance" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to Risk Acceptance
      </a>
      {" | "}
      <a href={`/ai-risk-assessments/${risk.assessmentId}`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to the risk assessment
      </a>
      <h1 style={{ fontSize: 20, margin: "12px 0 4px 0" }}>Risk Acceptance - {risk.title}</h1>
      <p style={muted}>
        AI system: {risk.aiSystem.name}. Risk Acceptance does not make the risk disappear: an authorized human reviews the residual risk, the justification,
        conditions and duration, and formally decides whether to tolerate it. It never closes a Finding.
      </p>
      {error && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...card, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      <section style={card}>
        <h2 style={heading}>The risk</h2>
        <p style={muted}>{risk.statement}</p>
        <p style={muted}>
          Current residual risk: {risk.residualScore ?? "Not assessed"} ({risk.residualRating ?? "-"}) | Risk owner:{" "}
          {risk.treatmentOwner ? risk.treatmentOwner.displayName + " (" + risk.treatmentOwner.email + ")" : "Not assigned"}
        </p>
        <p style={muted}>
          Planned treatment: {risk.treatment ?? "Not set"}
          {risk.treatment === "ACCEPT" ? " - this is only the plan. Only an approved Risk Acceptance below is authoritative." : ""}
        </p>
        <p style={{ ...muted, fontWeight: 600, color: active ? "#4ade80" : "#9ca3af" }}>
          {active ? "Risk Acceptance: Approved - Active until " + formatDate(active.expiresAt) : "Risk Acceptance: none active"}
        </p>
      </section>

      {!pending && !active && (
        <section style={card}>
          <h2 style={heading}>Request Risk Acceptance</h2>
          <p style={muted}>ADMIN or ANALYST. The request is not an acceptance - an independent ADMIN or REVIEWER must decide.</p>
          <span style={label}>Residual risk statement - what risk remains after existing controls</span>
          <textarea style={field} rows={2} value={statement} onChange={(e) => setStatement(e.target.value)} />
          <span style={label}>Business justification - why tolerate it rather than remediate now</span>
          <textarea style={field} rows={3} value={justification} onChange={(e) => setJustification(e.target.value)} />
          <span style={label}>Conditions (optional)</span>
          <input style={field} placeholder="e.g. Accepted only while human escalation stays enabled" value={conditions} onChange={(e) => setConditions(e.target.value)} />
          <span style={label}>Review / expiration date (required)</span>
          <input style={field} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <span style={label}>Related OPEN Finding (optional context - it stays OPEN)</span>
          <select style={field} value={findingId} onChange={(e) => setFindingId(e.target.value)}>
            <option value="">None</option>
            {openFindings.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
          <button
            style={button}
            disabled={busy || !statement || !justification || !expiresAt}
            onClick={() =>
              void run(
                () =>
                  post(`${API}/ai-risks/${risk.id}/risk-acceptance`, {
                    residualRiskStatement: statement,
                    justification,
                    conditions: conditions || undefined,
                    expiresAt,
                    governanceFindingId: findingId || undefined,
                  }),
                "Risk Acceptance requested - it is Pending Review.",
              )
            }
          >
            Request Risk Acceptance
          </button>
        </section>
      )}

      {pending && (
        <section style={card}>
          <h2 style={heading}>Decision (independent review)</h2>
          <p style={muted}>ADMIN or REVIEWER. You cannot decide a request you made.</p>
          <span style={label}>Decision rationale (required)</span>
          <textarea style={field} rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          <button
            style={{ ...button, background: "#15803d" }}
            disabled={busy}
            onClick={() => void run(() => post(`${API}/risk-acceptances/${pending.id}/decision`, { decision: "APPROVE", rationale }), "Approved - the risk is accepted until the expiration date.")}
          >
            Approve
          </button>
          <button
            style={{ ...button, background: "#b91c1c" }}
            disabled={busy}
            onClick={() => void run(() => post(`${API}/risk-acceptances/${pending.id}/decision`, { decision: "REJECT", rationale }), "Rejected - the risk is not accepted.")}
          >
            Reject
          </button>
        </section>
      )}

      <section style={card}>
        <h2 style={heading}>History</h2>
        {acceptances.length === 0 && <p style={muted}>No Risk Acceptance requests yet.</p>}
        {acceptances.map((a) => (
          <div key={a.id} style={{ borderTop: "1px solid #1f2937", padding: "10px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13 }}>
                Requested {formatDate(a.createdAt)} by {a.requestedBy ? a.requestedBy.displayName + " (" + a.requestedBy.email + ")" : "-"}
              </strong>
              <span style={{ border: "1px solid " + (STATE_COLOR[a.state] ?? "#94a3b8"), color: STATE_COLOR[a.state] ?? "#94a3b8", borderRadius: 999, padding: "2px 10px", fontSize: 12 }}>
                {STATE_LABEL[a.state] ?? a.state}
              </span>
            </div>
            <p style={muted}>
              Residual risk reviewed: {a.residualScoreAtRequest ?? "-"} ({a.residualRatingAtRequest ?? "-"}) - {a.residualRiskStatement}
            </p>
            <p style={muted}>Justification: {a.justification}</p>
            {a.conditions && <p style={muted}>Conditions: {a.conditions}</p>}
            <p style={muted}>
              Expires: {formatDate(a.expiresAt)}
              {a.governanceFinding ? " | Related Finding (still " + a.governanceFinding.status + "): " + a.governanceFinding.title : ""}
            </p>
            {a.decidedAt && (
              <p style={muted}>
                Decision {formatDate(a.decidedAt)} by {a.decidedBy ? a.decidedBy.displayName + " (" + a.decidedBy.email + ")" : "-"}: {a.decisionRationale}
              </p>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}