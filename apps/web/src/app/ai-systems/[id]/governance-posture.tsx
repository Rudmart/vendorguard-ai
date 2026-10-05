"use client";

/** Phase D1 - read-only posture summary + in-page navigation for the AI System governance hub. */
export type PostureVersion = { id: string; version: number; status: string; completedAt: string | null };
export type AssessmentPosture = {
  state: "NOT_ASSESSED" | "ASSESSMENT_REQUIRED" | "ASSESSED";
  latestRisk: PostureVersion | null;
  latestImpact: PostureVersion | null;
  riskInProgress: PostureVersion | null;
  impactInProgress: PostureVersion | null;
  reassessmentInProgress: { id: string } | null;
};

const STATE_STYLE: Record<AssessmentPosture["state"], { text: string; color: string }> = {
  NOT_ASSESSED: { text: "Not assessed", color: "#f87171" },
  ASSESSMENT_REQUIRED: { text: "Assessment required", color: "#fbbf24" },
  ASSESSED: { text: "Assessed", color: "#4ade80" },
};

const SECTIONS = [
  { id: "profile", label: "Profile & Classification" },
  { id: "risk-impact", label: "Risk & Impact" },
  { id: "assurance", label: "Assurance" },
  { id: "treatment", label: "Treatment & Oversight" },
];

function versionText(v: PostureVersion | null, href: string, empty: string) {
  if (!v) {
    return <span style={{ color: "#8b96ac" }}>{empty}</span>;
  }
  return (
    <a href={href + v.id} style={{ color: "#93c5fd" }}>
      v{v.version}
      {v.completedAt ? ` (completed ${new Date(v.completedAt).toLocaleDateString()})` : ""}
    </a>
  );
}

export default function GovernancePosture({
  aiSystemId,
  lifecycleStatus,
  owner,
  posture,
}: {
  aiSystemId: string;
  lifecycleStatus: string;
  owner: { displayName: string; email: string } | null;
  posture: AssessmentPosture | null;
}) {
  const label = { color: "#5d6786", fontSize: 11.5, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 };
  const value = { color: "#e6e9f0", fontSize: 13.5 };
  const state = posture ? STATE_STYLE[posture.state] : null;
  return (
    <div style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Governance posture</h2>
        {state && (
          <span style={{ fontSize: 12.5, fontWeight: 700, color: state.color, border: `1px solid ${state.color}`, borderRadius: 999, padding: "3px 12px" }}>
            {state.text}
          </span>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <div>
          <div style={label}>Lifecycle</div>
          <div style={value}>{lifecycleStatus.replace(/_/g, " ")}</div>
        </div>
        <div>
          <div style={label}>Owner</div>
          <div style={value}>{owner ? owner.displayName : "Not assigned"}</div>
        </div>
        <div>
          <div style={label}>Latest assessed risk</div>
          <div style={value}>{versionText(posture?.latestRisk ?? null, "/ai-risk-assessments/", "None completed")}</div>
        </div>
        <div>
          <div style={label}>Latest assessed impact</div>
          <div style={value}>{versionText(posture?.latestImpact ?? null, "/ai-impact-assessments/", "None completed")}</div>
        </div>
      </div>
      {posture && (posture.riskInProgress || posture.impactInProgress || posture.reassessmentInProgress) && (
        <div style={{ marginTop: 14, fontSize: 12.5, color: "#fbbf24", display: "flex", flexDirection: "column", gap: 4 }}>
          {posture.riskInProgress && (
            <a href={`/ai-risk-assessments/${posture.riskInProgress.id}`} style={{ color: "#fbbf24" }}>
              Risk Assessment v{posture.riskInProgress.version} in progress (not yet assessed posture)
            </a>
          )}
          {posture.impactInProgress && (
            <a href={`/ai-impact-assessments/${posture.impactInProgress.id}`} style={{ color: "#fbbf24" }}>
              Impact Assessment v{posture.impactInProgress.version} in progress (not yet assessed posture)
            </a>
          )}
          {posture.reassessmentInProgress && (
            <a href={`/ai-systems/${aiSystemId}/reassessments/${posture.reassessmentInProgress.id}`} style={{ color: "#fbbf24" }}>
              Reassessment in progress
            </a>
          )}
        </div>
      )}
      <p style={{ color: "#5d6786", fontSize: 11.5, marginTop: 14, marginBottom: 12 }}>
        Posture is derived from completed Risk and Impact Assessments and open reassessments. Lifecycle status is separate.
      </p>
      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid #2e3d63", paddingTop: 12 }}>
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{ fontSize: 12.5, color: "#93c5fd", border: "1px solid #2e3d63", borderRadius: 999, padding: "4px 12px", textDecoration: "none" }}
          >
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  );
}