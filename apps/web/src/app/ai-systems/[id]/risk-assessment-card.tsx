"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "../../current-user";
import VersionList, { readableStatus, summarizeVersions, type VersionRow } from "./assessment-versions";

const API = process.env.NEXT_PUBLIC_API_URL;

type RiskAssessmentRow = VersionRow & { name: string; risks: { id: string }[] };

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

/** Phase D1 - Risk Assessment versions with Start / Start New Version (mirrors the Impact Assessment card). */
export default function RiskAssessmentCard({ aiSystemId }: { aiSystemId: string }) {
  const [items, setItems] = useState<RiskAssessmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { can } = useCurrentUser();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/ai-systems/${aiSystemId}/risk-assessments`, { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { assessments?: RiskAssessmentRow[]; error?: string } | null;
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? `Could not load risk assessments (${res.status}).`);
          setItems([]);
          return;
        }
        setItems(data?.assessments ?? []);
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

  const { latest, canStart } = summarizeVersions(items ?? []);

  async function startAssessment() {
    setStarting(true);
    setError(null);
    try {
      const nextVersion = (latest?.version ?? 0) + 1;
      const res = await fetch(`${API}/ai-systems/${aiSystemId}/risk-assessments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Risk Assessment v${nextVersion}` }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setError(data?.error ?? `Could not start a risk assessment (${res.status}).`);
        return;
      }
      window.location.href = `/ai-risk-assessments/${data.id}`;
    } catch {
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>AI Risk Assessment</h2>
      <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
        Structured risk identification, inherent/residual scoring, controls, treatment, and human review. Completed versions are locked history; the
        latest completed version is the assessed posture.
      </p>

      {items === null && <p style={{ color: "#8b96ac", fontSize: 13 }}>Loading...</p>}
      {items !== null && !latest && <p style={{ color: "#8b96ac", fontSize: 13 }}>No risk assessment has been started yet.</p>}

      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}

      {items !== null && canStart && can("ai-system:update") && (
        <button type="button" onClick={startAssessment} disabled={starting} style={buttonStyle}>
          {starting ? "Starting..." : latest ? "Start new version" : "Start risk assessment"}
        </button>
      )}
      {items !== null && latest && !canStart && (
        <p style={{ color: "#fbbf24", fontSize: 12.5, margin: 0 }}>
          v{latest.version} is {readableStatus(latest.status).toLowerCase()}. Finish it and complete its review before starting a new version.
        </p>
      )}

      {items !== null && (
        <VersionList
          rows={items}
          hrefBase="/ai-risk-assessments/"
          detail={(row) => `${row.risks.length} risk${row.risks.length === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}