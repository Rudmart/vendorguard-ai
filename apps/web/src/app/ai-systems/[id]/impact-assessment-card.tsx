"use client";

import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type ImpactAssessmentListItem = {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewDecision: string | null;
  reviewedAt: string | null;
  createdAt: string;
  impactSummary: {
    totalImpacts: number;
    adverseImpacts: number;
    beneficialImpacts: number;
    majorOrSevereAdverseImpacts: number;
  };
};

function readable(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

const buttonStyle = {
  background: "#3b82f6",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "transparent",
  border: "1px solid #3b82f6",
  color: "#93c5fd",
};

export default function ImpactAssessmentCard({ aiSystemId }: { aiSystemId: string }) {
  const [items, setItems] = useState<ImpactAssessmentListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!aiSystemId) {
      return;
    }
    let cancelled = false;
    fetch(`${API}/ai-systems/${aiSystemId}/impact-assessments`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? `Could not load impact assessments (${res.status}).`);
          setItems([]);
          return;
        }
        setItems(data as ImpactAssessmentListItem[]);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the server. Check that the API is running.");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiSystemId]);

  async function startAssessment() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`${API}/ai-systems/${aiSystemId}/impact-assessments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Could not start an impact assessment (${res.status}).`);
        return;
      }
      window.location.href = `/ai-impact-assessments/${data.id}`;
    } catch {
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setStarting(false);
    }
  }

  const latest = items && items.length > 0 ? items[0] : null;
  const canStart = items !== null && (!latest || latest.status === "COMPLETED");
  const earlier = items && items.length > 1 ? items.slice(1) : [];

  return (
    <div style={{ background: "#161e33", border: "1px solid #28324d", borderRadius: 12, padding: 24, marginTop: 24 }}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>AI Impact Assessment</h2>
      <p style={{ color: "#8e9ab5", fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Who or what this AI system could affect, how significant the effects could be, and which safeguards and human
        oversight apply. Each version is approved by an independent reviewer.
      </p>

      {items === null && <p style={{ color: "#8e9ab5" }}>Loading impact assessments...</p>}
      {items !== null && !latest && <p style={{ color: "#8e9ab5" }}>No impact assessment has been started yet.</p>}

      {latest && (
        <div style={{ background: "#0d1323", border: "1px solid #28324d", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong>
              {latest.name} (version {latest.version})
            </strong>
            <span style={{ color: latest.status === "COMPLETED" ? "#34d399" : "#8e9ab5", fontSize: 13 }}>
              {latest.status === "COMPLETED" ? "Approved" : readable(latest.status)}
            </span>
          </div>
          <div style={{ color: "#c7d0e3", fontSize: 13, marginTop: 8 }}>
            {latest.impactSummary.totalImpacts} impacts identified ({latest.impactSummary.adverseImpacts} adverse,{" "}
            {latest.impactSummary.beneficialImpacts} beneficial). {latest.impactSummary.majorOrSevereAdverseImpacts} major or
            severe adverse.
          </div>
          <div style={{ color: "#8e9ab5", fontSize: 12, marginTop: 6 }}>
            {latest.reviewedAt
              ? `Last reviewed ${new Date(latest.reviewedAt).toLocaleDateString()}`
              : `Started ${new Date(latest.createdAt).toLocaleDateString()}, not yet reviewed`}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {latest && (
          <a href={`/ai-impact-assessments/${latest.id}`} style={secondaryButtonStyle}>
            View impact assessment
          </a>
        )}
        {canStart && (
          <button type="button" onClick={startAssessment} disabled={starting} style={buttonStyle}>
            {starting ? "Starting..." : latest ? "Start new version" : "Start impact assessment"}
          </button>
        )}
      </div>

      {earlier.length > 0 && (
        <p style={{ color: "#8e9ab5", fontSize: 12, marginTop: 16, marginBottom: 0 }}>
          Earlier versions:{" "}
          {earlier.map((item, index) => (
            <span key={item.id}>
              {index > 0 && ", "}
              <a href={`/ai-impact-assessments/${item.id}`} style={{ color: "#93c5fd" }}>
                version {item.version}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}