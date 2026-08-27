"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Control = {
  id: string;
  controlId: string;
  title: string;
  domain: string;
  summary: string;
};

type Finding = {
  id: string;
  controlId: string;
  status: string;
};

type AssessmentDetail = {
  id: string;
  status: string;
  vendor: { id: string; legalName: string };
  frameworks: { frameworkId: string; frameworkName: string; controls: Control[] }[];
  findings: Finding[];
};

const STATUS_OPTIONS = ["NOT_ASSESSED", "PASS", "PARTIAL", "FAIL", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", "NOT_APPLICABLE"];

const STATUS_COLORS: Record<string, string> = {
  PASS: "#22c55e",
  PARTIAL: "#eab308",
  FAIL: "#ef4444",
  INSUFFICIENT_EVIDENCE: "#5d6786",
  CONFLICTING_EVIDENCE: "#f97316",
  NOT_APPLICABLE: "#5d6786",
  NOT_ASSESSED: "#5d6786",
};

export default function AssessmentDetailPage() {
  const params = useParams();
  const assessmentId = params.id as string;
  const [data, setData] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingControlId, setSavingControlId] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/assessments/${assessmentId}`, {
      credentials: "include",
    });
    if (res.ok) {
      setData(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [assessmentId]);

  function findingFor(controlId: string) {
    return data?.findings.find((f) => f.controlId === controlId);
  }

  async function setStatus(controlId: string, status: string) {
    setSavingControlId(controlId);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/assessments/${assessmentId}/findings`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlId, status }),
    });
    await load();
    setSavingControlId(null);
  }

  if (loading) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Loading assessment...</main>;
  }
  if (!data) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Assessment not found.</main>;
  }

  const totalControls = data.frameworks.reduce((sum, fw) => sum + fw.controls.length, 0);
  const assessedCount = data.findings.filter((f) => f.status !== "NOT_ASSESSED").length;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Assessment: {data.vendor.legalName}</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 28 }}>
        Status: {data.status} &middot; {assessedCount}/{totalControls} controls assessed
      </p>

      <a
        href={`/assessments/${assessmentId}/questionnaire`}
        style={{
          display: "inline-block",
          background: "#3b82f6",
          color: "#000",
          fontWeight: 700,
          fontSize: 13,
          borderRadius: 8,
          padding: "8px 16px",
          textDecoration: "none",
          marginBottom: 24,
        }}
      >
        AI Vendor Risk Questionnaire &rarr;
      </a>

      <a
        href={`/assessments/${assessmentId}/risk-rating`}
        style={{
          display: "inline-block",
          background: "#22c55e",
          color: "#000",
          fontWeight: 700,
          fontSize: 13,
          borderRadius: 8,
          padding: "8px 16px",
          textDecoration: "none",
          marginBottom: 24,
          marginLeft: 12,
        }}
      >
        Configurable Risk Rating &rarr;
      </a>

      <a
        href={`/assessments/${assessmentId}/framework-mapping`}
        style={{
          display: "inline-block",
          background: "#a855f7",
          color: "#000",
          fontWeight: 700,
          fontSize: 13,
          borderRadius: 8,
          padding: "8px 16px",
          textDecoration: "none",
          marginBottom: 24,
          marginLeft: 12,
        }}
      >
        Framework Requirement Mapping &rarr;
      </a>

      {data.frameworks.map((fw) => (
        <div key={fw.frameworkId} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>{fw.frameworkName}</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {fw.controls.map((control) => {
              const finding = findingFor(control.id);
              const status = finding?.status ?? "NOT_ASSESSED";
              const color = STATUS_COLORS[status];
              return (
                <div
                  key={control.id}
                  style={{
                    background: "#1a2340",
                    border: "1px solid #2e3d63",
                    borderRadius: 10,
                    padding: "14px 18px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{control.title}</span>
                        <span style={{ fontSize: 10.5, color: "#5d6786", border: "1px solid #2e3d63", borderRadius: 4, padding: "1px 6px" }}>
                          {control.controlId}
                        </span>
                      </div>
                      <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 2 }}>{control.domain}</div>
                      <p style={{ fontSize: 13, marginTop: 6, marginBottom: 0, color: "#c3cad9" }}>{control.summary}</p>
                    </div>
                    <select
                      value={status}
                      disabled={savingControlId === control.id}
                      onChange={(e) => setStatus(control.id, e.target.value)}
                      style={{
                        background: "#141b2d",
                        color,
                        border: `1px solid ${color}`,
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt} style={{ color: "#000" }}>
                          {opt.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </main>
  );
}
