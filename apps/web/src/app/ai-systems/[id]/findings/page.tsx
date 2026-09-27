"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type Finding = {
  id: string;
  title: string;
  severity: string;
  status: string;
  createdAt: string;
  createdBy: { displayName: string; email: string };
  owner: { displayName: string; email: string } | null;
  aiControlTest: {
    testDate: string | null;
    overallEffectiveness: string;
    aiSystemControl: { id: string; control: { controlId: string; title: string } };
  } | null;
};
type Response = {
  aiSystem: { id: string; name: string };
  summary: { total: number; pendingReview: number; open: number; dismissed: number };
  findings: Finding[];
};

const SEVERITY_COLOR: Record<string, string> = { LOW: "#94a3b8", MEDIUM: "#fbbf24", HIGH: "#fb923c", CRITICAL: "#f87171" };
const STATUS_LABEL: Record<string, string> = { PENDING_REVIEW: "Pending Review", OPEN: "Open", DISMISSED: "Dismissed", CLOSED: "Closed" };
const STATUS_COLOR: Record<string, string> = { PENDING_REVIEW: "#fbbf24", OPEN: "#f87171", DISMISSED: "#94a3b8", CLOSED: "#4ade80" };
const RESULT_LABEL: Record<string, string> = { INEFFECTIVE: "Ineffective", PARTIALLY_EFFECTIVE: "Partially Effective", EFFECTIVE: "Effective", NOT_ASSESSED: "Not Tested" };
const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };

function Pill({ text, color }: { text: string; color: string }) {
  return <span style={{ border: "1px solid " + color, color, borderRadius: 999, padding: "2px 10px", fontSize: 12, whiteSpace: "nowrap" }}>{text}</span>;
}

export default function AiSystemFindingsPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }
    fetch(`${API}/ai-systems/${id}/findings`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        setData((await res.json()) as Response);
      })
      .catch(() => setError("Could not load findings"));
  }, [id]);

  if (!data) {
    return <main style={{ padding: 24, color: "#e5e7eb" }}>{error ?? "Loading..."}</main>;
  }

  return (
    <main style={{ padding: 24, color: "#e5e7eb", maxWidth: 1000 }}>
      <a href={`/ai-systems/${id}/controls`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to AI control set
      </a>
      <h1 style={{ fontSize: 20, margin: "12px 0 4px 0" }}>Findings - {data.aiSystem.name}</h1>
      <p style={muted}>
        Formal governance records of control deficiencies found through control testing. Open a Finding to see its source test, evidence and review
        history.
      </p>
      <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <span>Total: {data.summary.total}</span>
        <span>Pending review: {data.summary.pendingReview}</span>
        <span>Open: {data.summary.open}</span>
        <span>Dismissed: {data.summary.dismissed}</span>
      </div>
      <section style={card}>
        {data.findings.length === 0 && <p style={muted}>No findings for this AI system.</p>}
        {data.findings.map((f) => (
          <div key={f.id} style={{ borderTop: "1px solid #1f2937", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <a
                href={f.aiControlTest ? `/ai-system-controls/${f.aiControlTest.aiSystemControl.id}/evidence` : "#"}
                style={{ color: "#e5e7eb", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
              >
                {f.title}
              </a>
              <span style={{ display: "flex", gap: 8 }}>
                <Pill text={f.severity} color={SEVERITY_COLOR[f.severity] ?? "#94a3b8"} />
                <Pill text={STATUS_LABEL[f.status] ?? f.status} color={STATUS_COLOR[f.status] ?? "#94a3b8"} />
              </span>
            </div>
            <p style={muted}>
              Control: {f.aiControlTest ? f.aiControlTest.aiSystemControl.control.controlId + " - " + f.aiControlTest.aiSystemControl.control.title : "Unknown"} |
              Source test result: {RESULT_LABEL[f.aiControlTest?.overallEffectiveness ?? ""] ?? "Unknown"} | Created by {f.createdBy.displayName} on{" "}
              {new Date(f.createdAt).toLocaleDateString()} | Owner: {f.owner ? f.owner.displayName : "Not assigned"}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}