"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type AssessmentRef = { id: string; name: string; version: number; status: string; reviewDecision: string | null; reviewedAt: string | null; createdAt: string } | null;
type Detail = {
  id: string;
  aiSystemId: string;
  aiSystem: { id: string; name: string };
  reason: string;
  status: string;
  whatChanged: string;
  materialChange: boolean;
  materialChangeDescription: string | null;
  targetDate: string | null;
  pastTarget: boolean;
  createdAt: string;
  completedAt: string | null;
  conclusion: string | null;
  conclusionRationale: string | null;
  initiatedBy: { displayName: string; email: string } | null;
  completedBy: { displayName: string; email: string } | null;
  priorRiskAssessment: AssessmentRef;
  priorImpactAssessment: AssessmentRef;
  newRiskAssessment: AssessmentRef;
  newImpactAssessment: AssessmentRef;
  relatedRiskAcceptance: { id: string; state: string; expiresAt: string | null; aiRisk: { id: string; title: string } | null } | null;
  classificationChanges: { field: string; before: unknown; after: unknown }[];
  context: {
    openFindings: { id: string; title: string; severity: string }[];
    acceptances: { id: string; state: string; expiresAt: string | null; aiRisk: { id: string; title: string } | null }[];
    availableRiskAssessments: NonNullable<AssessmentRef>[];
    availableImpactAssessments: NonNullable<AssessmentRef>[];
  };
};

const REASON_LABEL: Record<string, string> = {
  PERIODIC_REVIEW: "Periodic review",
  MATERIAL_CHANGE: "Material change",
  REMEDIATION_COMPLETED: "Remediation completed",
  RISK_ACCEPTANCE_REVIEW: "Risk Acceptance review",
  REGULATORY_CHANGE: "Regulatory change",
  OTHER: "Other",
};
const CONCLUSIONS: { value: string; label: string; help: string }[] = [
  { value: "NO_MATERIAL_CHANGE", label: "No material change", help: "The review found no material governance change. This is not zero risk or permanent approval." },
  { value: "GOVERNANCE_UPDATED", label: "Governance updated", help: "Requires a linked NEW risk or impact assessment completed through its independent review." },
  { value: "FOLLOW_UP_REQUIRED", label: "Follow-up required", help: "More governance work is needed - use the existing workflows (testing, Findings, remediation, Risk Acceptance)." },
];

const card: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 18, marginBottom: 16 };
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
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#8b96ac", fontSize: 12.5 };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };
const heading: CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 8px 0" };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-";
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "(empty)";
  }
  return Array.isArray(value) ? (value.length ? value.join(", ") : "(none)") : String(value);
}

function AssessmentLine({ title, a, kind }: { title: string; a: AssessmentRef; kind: "risk" | "impact" }) {
  if (!a) {
    return <p style={muted}>{title}: none</p>;
  }
  const href = kind === "risk" ? `/ai-risk-assessments/${a.id}` : `/ai-impact-assessments/${a.id}`;
  return (
    <p style={muted}>
      {title}:{" "}
      <a href={href} style={{ color: "#93c5fd" }}>
        {a.name} (version {a.version})
      </a>{" "}
      - {a.status}
      {a.reviewDecision ? ", review " + a.reviewDecision : ""}
    </p>
  );
}

export default function ReassessmentDetailPage() {
  const params = useParams();
  const id = String(params?.reassessmentId ?? "");
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [newRisk, setNewRisk] = useState("");
  const [newImpact, setNewImpact] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [rationale, setRationale] = useState("");

  useEffect(() => {
    if (!id) {
      return;
    }
    fetch(`${API}/ai-reassessments/${id}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        const json = (await res.json()) as Detail;
        setData(json);
        setNewRisk(json.newRiskAssessment?.id ?? "");
        setNewImpact(json.newImpactAssessment?.id ?? "");
      })
      .catch(() => setError("Could not load this reassessment"));
  }, [id, reloadKey]);

  async function send(method: "PATCH" | "POST", url: string, body: unknown, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error ?? "Request failed (" + res.status + ")");
      return;
    }
    setMessage(success);
    setReloadKey((k) => k + 1);
  }

  if (!data) {
    return <main style={{ padding: 24, color: "#e6e9f0" }}>{error ?? "Loading..."}</main>;
  }
  const inProgress = data.status === "IN_PROGRESS";

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
      <a href={`/ai-systems/${data.aiSystemId}`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to {data.aiSystem.name}
      </a>
      <h1 style={{ fontSize: 22, margin: "10px 0 4px 0" }}>Reassessment - {REASON_LABEL[data.reason] ?? data.reason}</h1>
      <p style={muted}>
        {inProgress ? "In progress" : "Completed " + formatDate(data.completedAt) + " - locked"} | Started {formatDate(data.createdAt)} by{" "}
        {data.initiatedBy ? data.initiatedBy.displayName : "-"} | Target {formatDate(data.targetDate)}
        {data.pastTarget ? " (past target date)" : ""}
      </p>
      {error && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...card, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      <section style={card}>
        <h2 style={heading}>What changed</h2>
        <p style={muted}>{data.whatChanged}</p>
        <p style={muted}>
          Material change: {data.materialChange ? "Yes - " + (data.materialChangeDescription ?? "") : "No"}
        </p>
      </section>

      <section style={card}>
        <h2 style={heading}>AI system classification</h2>
        {data.classificationChanges.length === 0 ? (
          <p style={muted}>{inProgress ? "Reviewed so far - unchanged since this reassessment started." : "Reviewed - unchanged during this reassessment."}</p>
        ) : (
          data.classificationChanges.map((c) => (
            <p key={c.field} style={muted}>
              {c.field}: {show(c.before)} {" -> "} {show(c.after)}
            </p>
          ))
        )}
      </section>

      <section style={card}>
        <h2 style={heading}>Governance baseline (before) and new assessments (this cycle)</h2>
        <p style={muted}>The baseline records are history and are never changed. A changed posture is recorded as a NEW assessment version.</p>
        <AssessmentLine title="Prior risk assessment" a={data.priorRiskAssessment} kind="risk" />
        <AssessmentLine title="Prior impact assessment" a={data.priorImpactAssessment} kind="impact" />
        <AssessmentLine title="New risk assessment" a={data.newRiskAssessment} kind="risk" />
        <AssessmentLine title="New impact assessment" a={data.newImpactAssessment} kind="impact" />
        {inProgress && (
          <div style={{ marginTop: 10 }}>
            <p style={muted}>
              To produce a new assessment, start a new version from the{" "}
              <a href={`/ai-systems/${data.aiSystemId}`} style={{ color: "#93c5fd" }}>
                AI system page
              </a>
              , complete it through its independent review, then link it here.
            </p>
            <span style={label}>Link new risk assessment</span>
            <select style={field} value={newRisk} onChange={(e) => setNewRisk(e.target.value)}>
              <option value="">None</option>
              {data.context.availableRiskAssessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name + " (version " + a.version + ") - " + a.status}
                </option>
              ))}
            </select>
            <span style={label}>Link new impact assessment</span>
            <select style={field} value={newImpact} onChange={(e) => setNewImpact(e.target.value)}>
              <option value="">None</option>
              {data.context.availableImpactAssessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name + " (version " + a.version + ") - " + a.status}
                </option>
              ))}
            </select>
            <button
              style={button}
              disabled={busy}
              onClick={() =>
                void send("PATCH", `${API}/ai-reassessments/${data.id}`, { newRiskAssessmentId: newRisk || null, newImpactAssessmentId: newImpact || null }, "Links saved.")
              }
            >
              Save links
            </button>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={heading}>Current governance context</h2>
        {data.relatedRiskAcceptance && (
          <p style={muted}>
            Related Risk Acceptance: {data.relatedRiskAcceptance.aiRisk?.title ?? "-"} - {data.relatedRiskAcceptance.state} (expires{" "}
            {formatDate(data.relatedRiskAcceptance.expiresAt)}). It is not renewed by this reassessment - if continued acceptance is appropriate, submit a
            new request on the{" "}
            {data.relatedRiskAcceptance.aiRisk ? (
              <a href={`/risk-acceptance/${data.relatedRiskAcceptance.aiRisk.id}`} style={{ color: "#93c5fd" }}>
                Risk Acceptance page
              </a>
            ) : (
              "Risk Acceptance page"
            )}
            .
          </p>
        )}
        <p style={muted}>
          OPEN Findings: {data.context.openFindings.length === 0 ? "none" : data.context.openFindings.map((f) => f.title + " (" + f.severity + ")").join("; ")}
        </p>
        <p style={muted}>
          Approved Risk Acceptances:{" "}
          {data.context.acceptances.length === 0
            ? "none"
            : data.context.acceptances.map((a) => (a.aiRisk?.title ?? "Risk") + " - " + a.state + " until " + formatDate(a.expiresAt)).join("; ")}
        </p>
      </section>

      <section style={card}>
        <h2 style={heading}>Conclusion</h2>
        {inProgress ? (
          <>
            {CONCLUSIONS.map((c) => (
              <label key={c.value} style={{ ...muted, display: "block", marginBottom: 6 }}>
                <input type="radio" name="conclusion" value={c.value} checked={conclusion === c.value} onChange={() => setConclusion(c.value)} /> {c.label} -{" "}
                {c.help}
              </label>
            ))}
            <span style={label}>Rationale (required)</span>
            <textarea style={field} rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
            <button
              style={{ ...button, background: "#15803d" }}
              disabled={busy || !conclusion}
              onClick={() => void send("POST", `${API}/ai-reassessments/${data.id}/complete`, { conclusion, rationale }, "Reassessment completed and locked.")}
            >
              Complete reassessment
            </button>
          </>
        ) : (
          <>
            <p style={muted}>
              {CONCLUSIONS.find((c) => c.value === data.conclusion)?.label ?? data.conclusion} - completed {formatDate(data.completedAt)} by{" "}
              {data.completedBy ? data.completedBy.displayName : "-"}
            </p>
            <p style={muted}>Rationale: {data.conclusionRationale}</p>
            <p style={muted}>This reassessment is locked. A later governance cycle is a new reassessment.</p>
          </>
        )}
      </section>
    </main>
  );
}