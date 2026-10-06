"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import TenantUserSelect from "../../../../tenant-user-select";

const API = process.env.NEXT_PUBLIC_API_URL;

type Review = {
  id: string;
  reviewedAt: string;
  periodCovered: string | null;
  observation: string;
  observedValue: number | null;
  unit: string | null;
  result: string;
  rationale: string;
  reassessmentId: string | null;
  reviewer: { displayName: string; email: string } | null;
};
type Data = {
  check: {
    id: string;
    title: string;
    whatToReview: string;
    expectation: string;
    category: string;
    cadence: string;
    active: boolean;
    nextDueAt: string;
    dueState: string;
    owner: { displayName: string; email: string } | null;
    aiSystem: { id: string; name: string; lifecycleStatus: string };
  };
  reviews: Review[];
};

const RESULTS = [
  { value: "ACCEPTABLE", help: "No governance concern requiring escalation now (not permanent approval or zero risk)." },
  { value: "ATTENTION_REQUIRED", help: "Something needs human follow-up; reassessment not necessarily required." },
  { value: "REASSESSMENT_REQUIRED", help: "The condition warrants reconsideration through a Reassessment." },
];
const card: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 18, marginBottom: 16 };
const field: CSSProperties = { background: "#141b2d", color: "#e6e9f0", border: "1px solid #2e3d63", borderRadius: 6, padding: "6px 8px", fontSize: 13, width: "100%", boxSizing: "border-box", marginBottom: 8, colorScheme: "dark" };
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#8b96ac", fontSize: 12.5, margin: "4px 0" };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };
const heading: CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 8px 0" };
const words = (v: string) => v.replace(/_/g, " ").toLowerCase();

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "-";
}

export default function MonitoringCheckPage() {
  const params = useParams();
  const aiSystemId = String(params?.id ?? "");
  const checkId = String(params?.checkId ?? "");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [newOwner, setNewOwner] = useState("");
  const [form, setForm] = useState({ periodCovered: "", observation: "", observedValue: "", unit: "", result: "", rationale: "" });

  useEffect(() => {
    if (!checkId) {
      return;
    }
    fetch(`${API}/ai-monitoring-checks/${checkId}/reviews`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setData((await res.json()) as Data);
      })
      .catch(() => setError("Could not load this monitoring check"));
  }, [checkId, reloadKey]);

  async function send(method: "POST" | "PATCH", url: string, body: unknown): Promise<{ id?: string } | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok) {
      setError(json.error ?? "Request failed (" + res.status + ")");
      return null;
    }
    return json;
  }

  async function record() {
    const value = form.observedValue.trim() === "" ? undefined : Number(form.observedValue);
    const ok = await send("POST", `${API}/ai-monitoring-checks/${checkId}/reviews`, {
      periodCovered: form.periodCovered || undefined,
      observation: form.observation,
      observedValue: value,
      unit: form.unit || undefined,
      result: form.result,
      rationale: form.rationale,
    });
    if (ok) {
      setMessage("Monitoring review recorded. It is now part of the permanent history.");
      setForm({ periodCovered: "", observation: "", observedValue: "", unit: "", result: "", rationale: "" });
      setReloadKey((k) => k + 1);
    }
  }

  async function startReassessment(reviewId: string) {
    const created = await send("POST", `${API}/ai-monitoring-reviews/${reviewId}/start-reassessment`, {});
    if (created?.id) {
      window.location.href = `/ai-systems/${aiSystemId}/reassessments/${created.id}`;
    }
  }

  async function deactivate() {
    const ok = await send("PATCH", `${API}/ai-monitoring-checks/${checkId}`, { active: false });
    if (ok) {
      setMessage("Check deactivated. Its review history is kept.");
      setReloadKey((k) => k + 1);
    }
  }

  async function changeOwner() {
    const ok = await send("PATCH", `${API}/ai-monitoring-checks/${checkId}`, { ownerUserId: newOwner });
    if (ok) {
      setMessage("Owner updated.");
      setNewOwner("");
      setReloadKey((n) => n + 1);
    }
  }

  if (!data) {
    return <main style={{ padding: 24, color: "#e6e9f0" }}>{error ?? "Loading..."}</main>;
  }
  const k = data.check;
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
      <a href={`/ai-systems/${aiSystemId}`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to {k.aiSystem.name}
      </a>
      <h1 style={{ fontSize: 22, margin: "10px 0 4px 0" }}>Monitoring check - {k.title}</h1>
      <p style={muted}>
        {words(k.category)} | {words(k.cadence)} | owner {k.owner ? k.owner.displayName + " (" + k.owner.email + ")" : "-"} | {words(k.dueState)}
        {k.active ? " - next due " + formatDate(k.nextDueAt) : ""} | AI system lifecycle: {words(k.aiSystem.lifecycleStatus)}
      </p>
      {error && <div style={{ ...card, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...card, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      <section style={card}>
        <h2 style={heading}>What to review</h2>
        <p style={muted}>{k.whatToReview}</p>
        <p style={muted}>Expectation: {k.expectation}</p>
        {k.active && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", margin: "10px 0" }}>
            <div style={{ flex: 1 }}>
              <span style={label}>Change owner</span>
              <TenantUserSelect value={newOwner} onChange={setNewOwner} emptyLabel="Select new owner" style={field} />
            </div>
            <button style={{ ...button, marginBottom: 8 }} disabled={busy || !newOwner} onClick={() => void changeOwner()}>
              Save owner
            </button>
          </div>
        )}
        {k.active && (
          <button style={{ ...button, background: "#475569" }} disabled={busy} onClick={() => void deactivate()}>
            Deactivate check
          </button>
        )}
      </section>

      {k.active && (
        <section style={card}>
          <h2 style={heading}>Record a monitoring review</h2>
          <p style={muted}>ADMIN, ANALYST or REVIEWER. A recorded review cannot be edited - record a new one if needed.</p>
          <span style={label}>Period covered (optional)</span>
          <input style={field} placeholder="e.g. September 2026" value={form.periodCovered} onChange={(e) => setForm({ ...form, periodCovered: e.target.value })} />
          <span style={label}>Observation</span>
          <textarea style={field} rows={2} value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} />
          <span style={label}>Observed value (optional number) and unit</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={field} value={form.observedValue} onChange={(e) => setForm({ ...form, observedValue: e.target.value })} />
            <input style={field} placeholder="e.g. % overridden" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </div>
          {RESULTS.map((r) => (
            <label key={r.value} style={{ ...muted, display: "block", marginBottom: 6 }}>
              <input type="radio" name="result" checked={form.result === r.value} onChange={() => setForm({ ...form, result: r.value })} /> {words(r.value)} - {r.help}
            </label>
          ))}
          <span style={label}>Rationale</span>
          <textarea style={field} rows={2} value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} />
          <button style={button} disabled={busy || !form.observation || !form.result || !form.rationale} onClick={() => void record()}>
            Record review
          </button>
        </section>
      )}

      <section style={card}>
        <h2 style={heading}>Review history</h2>
        {data.reviews.length === 0 && <p style={muted}>No reviews recorded yet.</p>}
        {data.reviews.map((r) => (
          <div key={r.id} style={{ borderTop: "1px solid #2e3d63", padding: "10px 0" }}>
            <p style={{ ...muted, color: "#e6e9f0" }}>
              {formatDate(r.reviewedAt)} by {r.reviewer ? r.reviewer.displayName : "-"} - {words(r.result)}
              {r.periodCovered ? " | " + r.periodCovered : ""}
            </p>
            <p style={muted}>
              Observation: {r.observation}
              {r.observedValue !== null ? " (value " + r.observedValue + (r.unit ? " " + r.unit : "") + ")" : ""}
            </p>
            <p style={muted}>Rationale: {r.rationale}</p>
            {r.reassessmentId ? (
              <a href={`/ai-systems/${aiSystemId}/reassessments/${r.reassessmentId}`} style={{ color: "#93c5fd", fontSize: 12.5 }}>
                Reassessment started from this review
              </a>
            ) : r.result !== "ACCEPTABLE" ? (
              <button style={{ ...button, background: "#b45309" }} disabled={busy} onClick={() => void startReassessment(r.id)}>
                Start reassessment (ADMIN / ANALYST)
              </button>
            ) : null}
          </div>
        ))}
      </section>
    </main>
  );
}