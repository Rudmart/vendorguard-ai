import Link from "next/link";
import type { CSSProperties } from "react";
import { HUMAN_AUTHORITY, type GuideStage } from "./workflow-guide-data";

// Shared Learning Center layout for the AI workflow guides. Read-only content - no API calls.
const card: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: "18px 20px" };
const label: CSSProperties = { color: "#c7cee2", fontWeight: 600 };
const row: CSSProperties = { fontSize: 12.5, color: "#8b96ac", lineHeight: 1.55, margin: "4px 0" };

function StatusBadge({ status }: { status: GuideStage["status"] }) {
  const available = status === "AVAILABLE";
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        borderRadius: 999,
        padding: "2px 9px",
        border: `1px solid ${available ? "#22c55e" : "#f59e0b"}`,
        color: available ? "#86efac" : "#fbbf24",
        whiteSpace: "nowrap",
      }}
    >
      {available ? "AVAILABLE IN VENDORGUARD" : "PLANNED VENDORGUARD CAPABILITY"}
    </span>
  );
}

export default function WorkflowGuide({ title, intro, stages }: { title: string; intro: string; stages: GuideStage[] }) {
  const available = stages.filter((s) => s.status === "AVAILABLE").length;
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{title}</h1>
      <p style={{ color: "#8b96ac", fontSize: 13.5, marginBottom: 14, lineHeight: 1.6 }}>{intro}</p>
      <div
        style={{
          background: "rgba(59,130,246,0.10)",
          border: "1px solid #3b82f6",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
          fontSize: 13,
          color: "#c7cee2",
          lineHeight: 1.55,
        }}
      >
        <strong style={{ color: "#93c5fd" }}>{HUMAN_AUTHORITY}</strong> AI may summarise, analyse, calculate, recommend, identify gaps and propose
        findings. Humans make the governance decisions: approvals, finding decisions, evidence acceptance, risk acceptance, remediation verification and
        exceptions.
      </div>
      <p style={{ ...row, marginBottom: 20 }}>
        {stages.length} stages - {available} available in VendorGuard today, {stages.length - available} planned.
      </p>

      <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {stages.map((s) => (
          <li key={s.n} style={{ ...card, borderLeft: `3px solid ${s.status === "AVAILABLE" ? "#3b82f6" : "#f59e0b"}` }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: "rgba(167,139,250,0.14)",
                  color: "#a78bfa",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {s.n}
              </span>
              <span style={{ fontWeight: 600, fontSize: 15 }}>{s.title}</span>
              <StatusBadge status={s.status} />
            </div>
            <p style={row}><span style={label}>What it is: </span>{s.what}</p>
            <p style={row}><span style={label}>Why it matters: </span>{s.why}</p>
            <p style={row}><span style={label}>VendorGuard area: </span>{s.area}</p>
            <p style={row}><span style={label}>Human responsibility: </span>{s.human}</p>
            <p style={row}><span style={label}>Evidence / output: </span>{s.output}</p>
            <p style={row}><span style={label}>Next step: </span>{s.next}</p>
            {s.note && <p style={{ ...row, fontStyle: "italic", color: "#7c86a2" }}>{s.note}</p>}
            {s.links.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {s.links.map((l) => (
                  <Link
                    key={l.href + l.label}
                    href={l.href}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#3b82f6",
                      border: "1px solid #3b82f6",
                      borderRadius: 8,
                      padding: "7px 12px",
                      textDecoration: "none",
                    }}
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}