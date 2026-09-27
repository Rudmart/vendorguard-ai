"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type UserRef = { id: string; displayName: string; email: string };
type TestSummary = { id: string; status: string; method: string; testDate: string | null; overallEffectiveness: string };
type FindingReview = { id: string; decision: string; rationale: string; previousStatus: string; newStatus: string; createdAt: string; reviewer: UserRef };
type Finding = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  createdAt: string;
  createdBy: UserRef;
  owner: UserRef | null;
  aiControlTest: { id: string; testDate: string | null; overallEffectiveness: string; method: string } | null;
  reviews: FindingReview[];
};

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_COLOR: Record<string, string> = { LOW: "#94a3b8", MEDIUM: "#fbbf24", HIGH: "#fb923c", CRITICAL: "#f87171" };
const STATUS_LABEL: Record<string, string> = { PENDING_REVIEW: "Pending Review", OPEN: "Open", DISMISSED: "Dismissed", CLOSED: "Closed" };
const STATUS_COLOR: Record<string, string> = { PENDING_REVIEW: "#fbbf24", OPEN: "#f87171", DISMISSED: "#94a3b8", CLOSED: "#4ade80" };
const RESULT_LABEL: Record<string, string> = {
  NOT_ASSESSED: "Not Tested",
  INEFFECTIVE: "Ineffective",
  PARTIALLY_EFFECTIVE: "Partially Effective",
  EFFECTIVE: "Effective",
};

const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 };
const inner: CSSProperties = { background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8, padding: 12, marginBottom: 12 };
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

function Pill({ text, color }: { text: string; color: string }) {
  return <span style={{ border: "1px solid " + color, color, borderRadius: 999, padding: "2px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{text}</span>;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not set";
}

async function send(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Request failed (" + res.status + ")";
}

export default function FindingsSection({ controlRecordId, aiSystemId, refreshKey }: { controlRecordId: string; aiSystemId: string; refreshKey: number }) {
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [sourceTestId, setSourceTestId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("");
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [testsRes, findingsRes] = await Promise.all([
        fetch(`${API}/ai-system-controls/${controlRecordId}/tests`, { credentials: "include" }),
        fetch(`${API}/ai-system-controls/${controlRecordId}/findings`, { credentials: "include" }),
      ]);
      if (!testsRes.ok || !findingsRes.ok) {
        throw new Error("load failed");
      }
      const testsJson = (await testsRes.json()) as { tests: TestSummary[] };
      const findingsJson = (await findingsRes.json()) as { findings: Finding[] };
      if (!cancelled) {
        setTests(testsJson.tests);
        setFindings(findingsJson.findings);
      }
    };
    load().catch(() => {
      if (!cancelled) {
        setError("Could not load findings");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [controlRecordId, reloadKey, refreshKey]);

  async function run(action: () => Promise<string | null>, success: string, after?: () => void) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const err = await action();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setMessage(success);
    if (after) {
      after();
    }
    setReloadKey((k) => k + 1);
  }

  const usedTestIds = new Set(findings.map((f) => f.aiControlTest?.id).filter((v): v is string => Boolean(v)));
  const eligible = tests.filter(
    (t) => t.status === "COMPLETED" && (t.overallEffectiveness === "PARTIALLY_EFFECTIVE" || t.overallEffectiveness === "INEFFECTIVE") && !usedTestIds.has(t.id),
  );

  return (
    <section style={card}>
      <h2 style={heading}>Findings</h2>
      <p style={muted}>
        A control test result is an assurance conclusion. A Finding is the formal governance record of a deficiency. Findings are never created
        automatically - a person decides whether a test result warrants one. Reviewing a Finding is not risk acceptance.
      </p>
      <a href={`/ai-systems/${aiSystemId}/findings`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        {"All findings for this AI system ->"}
      </a>

      {error && <div style={{ ...inner, marginTop: 10, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...inner, marginTop: 10, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      <div style={{ ...inner, marginTop: 12 }}>
        <div style={{ ...muted, fontWeight: 600, marginBottom: 8 }}>Create a Finding from a deficient control test</div>
        {eligible.length === 0 ? (
          <p style={muted}>No completed Partially Effective or Ineffective test without a Finding. Only deficient test results can become Findings.</p>
        ) : (
          <>
            <p style={muted}>ADMIN, REVIEWER or AUDITOR. One Finding per control test.</p>
            <span style={label}>Source control test</span>
            <select style={field} value={sourceTestId} onChange={(e) => setSourceTestId(e.target.value)}>
              <option value="">Select a test...</option>
              {eligible.map((t) => (
                <option key={t.id} value={t.id}>
                  {"Test on " + formatDate(t.testDate) + " - Overall: " + (RESULT_LABEL[t.overallEffectiveness] ?? t.overallEffectiveness)}
                </option>
              ))}
            </select>
            <span style={label}>Finding title</span>
            <input
              style={field}
              placeholder="e.g. Human approval not consistently documented for high-impact AI decisions"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span style={label}>Deficiency description - what was observed</span>
            <textarea
              style={field}
              rows={3}
              placeholder="e.g. 2 of 10 sampled high-impact decisions lacked documented human approval."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <span style={label}>Severity - your judgment of the deficiency</span>
            <select style={field} value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Select severity...</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              style={button}
              disabled={busy || !sourceTestId || !title || !description || !severity}
              onClick={() =>
                void run(
                  () => send(`${API}/ai-control-tests/${sourceTestId}/findings`, { title, description, severity }),
                  "Finding created. It is now Pending Review by an independent reviewer.",
                  () => {
                    setSourceTestId("");
                    setTitle("");
                    setDescription("");
                    setSeverity("");
                  },
                )
              }
            >
              Create Finding
            </button>
          </>
        )}
      </div>

      {findings.length === 0 && <p style={muted}>No findings for this control.</p>}
      {findings.map((f) => (
        <div key={f.id} style={{ borderTop: "1px solid #1f2937", padding: "12px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 14 }}>{f.title}</strong>
            <span style={{ display: "flex", gap: 8 }}>
              <Pill text={f.severity} color={SEVERITY_COLOR[f.severity] ?? "#94a3b8"} />
              <Pill text={STATUS_LABEL[f.status] ?? f.status} color={STATUS_COLOR[f.status] ?? "#94a3b8"} />
            </span>
          </div>
          <p style={muted}>{f.description}</p>
          <p style={muted}>
            Source: control test on {formatDate(f.aiControlTest?.testDate ?? null)} - Overall:{" "}
            {RESULT_LABEL[f.aiControlTest?.overallEffectiveness ?? ""] ?? "Unknown"} | Created by {f.createdBy.displayName} ({f.createdBy.email}) on{" "}
            {new Date(f.createdAt).toLocaleString()} | Owner: {f.owner ? f.owner.displayName + " (" + f.owner.email + ")" : "Not assigned"}
          </p>

          {f.status === "PENDING_REVIEW" && (
            <div style={{ marginTop: 8 }}>
              <textarea
                style={field}
                rows={2}
                placeholder="Reviewer rationale (required)"
                value={rationales[f.id] ?? ""}
                onChange={(e) => setRationales((prev) => ({ ...prev, [f.id]: e.target.value }))}
              />
              <button
                style={{ ...button, background: "#b91c1c" }}
                disabled={busy}
                onClick={() => void run(() => send(`${API}/governance-findings/${f.id}/review`, { decision: "CONFIRM", rationale: rationales[f.id] ?? "" }), "Finding confirmed - it is now Open.")}
              >
                Confirm (Open)
              </button>
              <button
                style={{ ...button, background: "#475569" }}
                disabled={busy}
                onClick={() => void run(() => send(`${API}/governance-findings/${f.id}/review`, { decision: "DISMISS", rationale: rationales[f.id] ?? "" }), "Finding dismissed.")}
              >
                Dismiss
              </button>
              <span style={muted}>Reviewers only (ADMIN or REVIEWER). You cannot review a Finding you created.</span>
            </div>
          )}

          {f.reviews.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...muted, fontWeight: 600 }}>Review history</div>
              {f.reviews.map((r) => (
                <p key={r.id} style={{ ...muted, margin: "4px 0" }}>
                  {new Date(r.createdAt).toLocaleString()} - {r.reviewer.displayName} ({r.reviewer.email}): {r.decision} ({STATUS_LABEL[r.previousStatus] ?? r.previousStatus}
                  {" -> "}
                  {STATUS_LABEL[r.newStatus] ?? r.newStatus}) - {r.rationale}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}