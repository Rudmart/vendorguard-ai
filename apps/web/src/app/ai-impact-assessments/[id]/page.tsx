"use client";

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL;

type Impact = {
  id: string;
  title: string;
  category: string;
  direction: "BENEFICIAL" | "ADVERSE";
  description: string;
  affectedPopulation: string;
  affectedGroupDescription: string | null;
  severity: number;
  scale: string;
  reversibility: string;
  vulnerablePopulations: boolean;
  vulnerablePopulationsExplanation: string | null;
  oversightRequirement: string | null;
  oversightDescription: string | null;
  escalationMechanism: string | null;
  humanCanOverride: boolean | null;
  safeguards: string | null;
};

type ImpactSummary = {
  totalImpacts: number;
  beneficialImpacts: number;
  adverseImpacts: number;
  majorOrSevereAdverseImpacts: number;
  vulnerablePopulationImpacts: number;
  difficultOrIrreversibleImpacts: number;
  highestAdverseSeverity: number | null;
};

type Person = { id: string; displayName: string; email: string } | null;

type ImpactAssessment = {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewDecision: string | null;
  reviewRationale: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  impacts: Impact[];
  impactSummary: ImpactSummary;
  assessor: Person;
  reviewer: Person;
  aiSystem: {
    id: string;
    name: string;
    impactLevel: string | null;
    humanOversight: string | null;
    decisionRole: string | null;
    affectedPopulation: string[];
    externalImpact: boolean | null;
    regulatoryRelevance: string[];
    riskTier: string | null;
  };
};

const CATEGORIES = [
  "FAIRNESS",
  "PRIVACY",
  "INDIVIDUAL_RIGHTS",
  "ACCESSIBILITY",
  "SAFETY",
  "HUMAN_AUTONOMY",
  "TRANSPARENCY",
  "ECONOMIC",
  "OPERATIONAL",
  "SOCIETAL",
];
const POPULATIONS = ["EMPLOYEES", "CUSTOMERS", "PUBLIC", "OTHER"];
const SEVERITY_LABELS: Record<number, string> = { 1: "Minimal", 2: "Minor", 3: "Moderate", 4: "Major", 5: "Severe" };
const SCALE_OPTIONS = [
  { value: "LIMITED", label: "Limited", help: "A few people or a single process" },
  { value: "MODERATE", label: "Moderate", help: "A team, department, or defined customer segment" },
  { value: "BROAD", label: "Broad", help: "Many people across the organization or customer base" },
  { value: "MASS", label: "Mass", help: "The general public or very large populations" },
];
const REVERSIBILITY_OPTIONS = [
  { value: "REVERSIBLE", label: "Reversible", help: "Can be corrected quickly with little lasting effect" },
  { value: "PARTIALLY_REVERSIBLE", label: "Partially reversible", help: "Can be corrected, but some effects may remain" },
  { value: "DIFFICULT_TO_REVERSE", label: "Difficult to reverse", help: "Correction is slow, costly, or incomplete" },
  { value: "IRREVERSIBLE", label: "Irreversible", help: "Cannot reasonably be undone" },
];
const OVERSIGHT_OPTIONS = ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"];
const EDITABLE_STATUSES = ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW"];

const colors = {
  card: "#161e33",
  inset: "#0d1323",
  border: "#28324d",
  muted: "#8e9ab5",
  soft: "#c7d0e3",
  accent: "#3b82f6",
  beneficial: "#34d399",
  adverse: "#fb923c",
  danger: "#f87171",
};

const cardStyle: CSSProperties = {
  background: colors.card,
  border: `1px solid ${colors.border}`,
  borderRadius: 12,
  padding: 24,
  marginBottom: 20,
};
const insetStyle: CSSProperties = {
  background: colors.inset,
  border: `1px solid ${colors.border}`,
  borderRadius: 10,
  padding: 16,
};
const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: colors.inset,
  color: "inherit",
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
};
const buttonStyle: CSSProperties = {
  background: colors.accent,
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontWeight: 600,
  cursor: "pointer",
};
const quietButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  border: `1px solid ${colors.border}`,
  color: colors.soft,
  padding: "6px 12px",
  fontWeight: 500,
};
const headingStyle: CSSProperties = { fontSize: 15, marginTop: 0, marginBottom: 4 };
const introStyle: CSSProperties = { color: colors.muted, fontSize: 13, marginTop: 0, marginBottom: 16 };

function readable(value: string | null | undefined): string {
  if (!value) {
    return "Not set";
  }
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? readable(value);
}

async function sendRequest(method: string, path: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      return null;
    }
    const data = await res.json().catch(() => null);
    return data && typeof data.error === "string" ? data.error : `Request failed (${res.status}).`;
  } catch {
    return "Could not reach the server. Check that the API is running.";
  }
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>{label}</span>
      {children}
      {help && <span style={{ display: "block", fontSize: 12, color: colors.muted, marginTop: 4 }}>{help}</span>}
    </label>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{children}</div>
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" style={{ color: colors.danger, fontSize: 13, margin: "8px 0" }}>
      {message}
    </p>
  );
}

function ImpactForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Impact;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const initialOverride = initial?.humanCanOverride;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "FAIRNESS");
  const [direction, setDirection] = useState<string>(initial?.direction ?? "ADVERSE");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [population, setPopulation] = useState(initial?.affectedPopulation ?? "CUSTOMERS");
  const [groupDescription, setGroupDescription] = useState(initial?.affectedGroupDescription ?? "");
  const [severity, setSeverity] = useState(String(initial?.severity ?? 3));
  const [scale, setScale] = useState(initial?.scale ?? "MODERATE");
  const [reversibility, setReversibility] = useState(initial?.reversibility ?? "REVERSIBLE");
  const [vulnerable, setVulnerable] = useState(initial?.vulnerablePopulations ?? false);
  const [vulnerableExplanation, setVulnerableExplanation] = useState(initial?.vulnerablePopulationsExplanation ?? "");
  const [oversight, setOversight] = useState(initial?.oversightRequirement ?? "");
  const [oversightDescription, setOversightDescription] = useState(initial?.oversightDescription ?? "");
  const [escalation, setEscalation] = useState(initial?.escalationMechanism ?? "");
  const [override, setOverride] = useState(initialOverride === true ? "yes" : initialOverride === false ? "no" : "");
  const [safeguards, setSafeguards] = useState(initial?.safeguards ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scaleHelp = SCALE_OPTIONS.find((option) => option.value === scale)?.help;
  const reversibilityHelp = REVERSIBILITY_OPTIONS.find((option) => option.value === reversibility)?.help;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (vulnerable && !vulnerableExplanation.trim()) {
      setError("Explain which vulnerable or sensitive groups may be affected, and why.");
      return;
    }
    setSaving(true);
    const result = await onSubmit({
      title,
      category,
      direction,
      description,
      affectedPopulation: population,
      affectedGroupDescription: groupDescription.trim() ? groupDescription : null,
      severity: Number(severity),
      scale,
      reversibility,
      vulnerablePopulations: vulnerable,
      vulnerablePopulationsExplanation: vulnerable ? vulnerableExplanation : null,
      oversightRequirement: oversight || null,
      oversightDescription: oversightDescription.trim() ? oversightDescription : null,
      escalationMechanism: escalation.trim() ? escalation : null,
      humanCanOverride: override === "" ? null : override === "yes",
      safeguards: safeguards.trim() ? safeguards : null,
    });
    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    if (!initial) {
      setTitle("");
      setDescription("");
      setGroupDescription("");
      setVulnerable(false);
      setVulnerableExplanation("");
      setOversightDescription("");
      setEscalation("");
      setOverride("");
      setSafeguards("");
    }
  }

  const directionButton = (value: string, label: string, color: string): ReactNode => (
    <button
      type="button"
      onClick={() => setDirection(value)}
      aria-pressed={direction === value}
      style={{
        ...quietButtonStyle,
        padding: "10px 16px",
        borderColor: direction === value ? color : colors.border,
        color: direction === value ? color : colors.soft,
        fontWeight: direction === value ? 700 : 500,
      }}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={handleSubmit}>
      <Field label="Impact title">
        <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Disparate lending outcomes" />
      </Field>

      <div style={{ marginBottom: 14 }}>
        <span style={{ display: "block", fontSize: 13, marginBottom: 6 }}>Is this effect beneficial or adverse?</span>
        <div style={{ display: "flex", gap: 10 }}>
          {directionButton("ADVERSE", "Adverse", colors.adverse)}
          {directionButton("BENEFICIAL", "Beneficial", colors.beneficial)}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <Field label="Impact area">
          <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {readable(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Who is affected">
          <select style={inputStyle} value={population} onChange={(e) => setPopulation(e.target.value)}>
            {POPULATIONS.map((value) => (
              <option key={value} value={value}>
                {readable(value)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Affected group, in more detail (optional)">
        <input
          style={inputStyle}
          value={groupDescription}
          onChange={(e) => setGroupDescription(e.target.value)}
          placeholder="e.g. Loan applicants"
        />
      </Field>

      <Field label="What could happen">
        <textarea
          style={{ ...inputStyle, minHeight: 80 }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the effect on the people or processes affected."
        />
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <Field label="Severity" help="How serious the consequence would be for those affected.">
          <select style={inputStyle} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={String(value)}>
                {value} - {SEVERITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Scale or reach" help={scaleHelp}>
          <select style={inputStyle} value={scale} onChange={(e) => setScale(e.target.value)}>
            {SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reversibility" help={reversibilityHelp}>
          <select style={inputStyle} value={reversibility} onChange={(e) => setReversibility(e.target.value)}>
            {REVERSIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, fontSize: 14 }}>
        <input type="checkbox" checked={vulnerable} onChange={(e) => setVulnerable(e.target.checked)} />
        Vulnerable or sensitive populations may be affected
      </label>
      {vulnerable && (
        <Field label="Explain which groups, and why (required)">
          <textarea
            style={{ ...inputStyle, minHeight: 60 }}
            value={vulnerableExplanation}
            onChange={(e) => setVulnerableExplanation(e.target.value)}
          />
        </Field>
      )}

      <div style={{ ...insetStyle, marginBottom: 14 }}>
        <div style={{ fontSize: 13, marginBottom: 12, color: colors.soft }}>Human oversight and safeguards for this impact</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <Field label="Human oversight">
            <select style={inputStyle} value={oversight} onChange={(e) => setOversight(e.target.value)}>
              <option value="">Not set</option>
              {OVERSIGHT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {readable(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Can a human review or override the AI-supported decision?">
            <select style={inputStyle} value={override} onChange={(e) => setOverride(e.target.value)}>
              <option value="">Not set</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </Field>
        </div>
        <Field label="How oversight works (optional)">
          <textarea
            style={{ ...inputStyle, minHeight: 50 }}
            value={oversightDescription}
            onChange={(e) => setOversightDescription(e.target.value)}
          />
        </Field>
        <Field label="Escalation or intervention path (optional)">
          <input style={inputStyle} value={escalation} onChange={(e) => setEscalation(e.target.value)} />
        </Field>
        <Field label="Safeguards or mitigation (optional)">
          <textarea style={{ ...inputStyle, minHeight: 50 }} value={safeguards} onChange={(e) => setSafeguards(e.target.value)} />
        </Field>
      </div>

      <ErrorText message={error} />
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" disabled={saving} style={buttonStyle}>
          {saving ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={quietButtonStyle}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function ImpactCard({ impact, locked, onChanged }: { impact: Impact; locked: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdverse = impact.direction === "ADVERSE";
  const directionColor = isAdverse ? colors.adverse : colors.beneficial;

  async function handleDelete() {
    if (!window.confirm(`Delete the impact "${impact.title}"?`)) {
      return;
    }
    const result = await sendRequest("DELETE", `/ai-impacts/${impact.id}`);
    if (result) {
      setError(result);
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <div style={{ ...insetStyle, borderLeft: `4px solid ${directionColor}`, marginBottom: 14 }}>
        <ImpactForm
          initial={impact}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (payload) => {
            const result = await sendRequest("PATCH", `/ai-impacts/${impact.id}`, payload);
            if (!result) {
              setEditing(false);
              onChanged();
            }
            return result;
          }}
        />
      </div>
    );
  }

  const overrideText = impact.humanCanOverride === null ? "Not set" : impact.humanCanOverride ? "Yes" : "No";

  return (
    <div style={{ ...insetStyle, borderLeft: `4px solid ${directionColor}`, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{impact.title}</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <span style={{ color: directionColor, fontWeight: 700 }}>{isAdverse ? "Adverse impact" : "Beneficial impact"}</span>
            <span style={{ color: colors.muted }}> in {readable(impact.category)}</span>
          </div>
        </div>
        {!locked && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <button type="button" style={quietButtonStyle} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" style={quietButtonStyle} onClick={handleDelete}>
              Delete
            </button>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 12 }}>
        <Detail label="Who is affected">
          {readable(impact.affectedPopulation)}
          {impact.affectedGroupDescription ? `: ${impact.affectedGroupDescription}` : ""}
        </Detail>
        <Detail label="Severity">
          {impact.severity} - {SEVERITY_LABELS[impact.severity]}
        </Detail>
        <Detail label="Scale or reach">{optionLabel(SCALE_OPTIONS, impact.scale)}</Detail>
        <Detail label="Reversibility">{optionLabel(REVERSIBILITY_OPTIONS, impact.reversibility)}</Detail>
      </div>

      <Detail label="What could happen">{impact.description}</Detail>

      <div style={{ marginTop: 12 }}>
        <Detail label="Vulnerable or sensitive populations">
          {impact.vulnerablePopulations ? `Yes. ${impact.vulnerablePopulationsExplanation ?? ""}` : "No"}
        </Detail>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 12 }}>
        <Detail label="Human oversight">{readable(impact.oversightRequirement)}</Detail>
        <Detail label="Human can review or override">{overrideText}</Detail>
        <Detail label="Safeguards">
          {impact.safeguards ?? (isAdverse ? <span style={{ color: colors.adverse }}>None documented</span> : "None documented")}
        </Detail>
      </div>
      {(impact.oversightDescription || impact.escalationMechanism) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 12 }}>
          {impact.oversightDescription && <Detail label="How oversight works">{impact.oversightDescription}</Detail>}
          {impact.escalationMechanism && <Detail label="Escalation path">{impact.escalationMechanism}</Detail>}
        </div>
      )}
      <ErrorText message={error} />
    </div>
  );
}

export default function AiImpactAssessmentPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [assessment, setAssessment] = useState<ImpactAssessment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [statusChoice, setStatusChoice] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [decision, setDecision] = useState("APPROVED");
  const [rationale, setRationale] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    fetch(`${API}/ai-impact-assessments/${id}`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setLoadError(data?.error ?? `Could not load this impact assessment (${res.status}).`);
          return;
        }
        setLoadError(null);
        setAssessment(data as ImpactAssessment);
        setStatusChoice((data as ImpactAssessment).status);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Could not reach the server. Check that the API is running.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  function reload() {
    setReloadKey((key) => key + 1);
  }

  const pageStyle: CSSProperties = { maxWidth: 1000, margin: "0 auto", padding: "32px 24px" };

  if (loadError) {
    return (
      <main style={pageStyle}>
        <ErrorText message={loadError} />
      </main>
    );
  }
  if (!assessment) {
    return (
      <main style={pageStyle}>
        <p style={{ color: colors.muted }}>Loading impact assessment...</p>
      </main>
    );
  }

  const current = assessment;
  const locked = current.status === "COMPLETED";
  const summary = current.impactSummary;
  const adverseImpacts = current.impacts.filter((impact) => impact.direction === "ADVERSE");
  const populationGroups = POPULATIONS.map((population) => ({
    population,
    impacts: current.impacts.filter((impact) => impact.affectedPopulation === population),
  })).filter((group) => group.impacts.length > 0);

  async function updateStatus() {
    setStatusError(null);
    const result = await sendRequest("PATCH", `/ai-impact-assessments/${current.id}`, { status: statusChoice });
    if (result) {
      setStatusError(result);
      return;
    }
    reload();
  }

  async function submitReview(event: FormEvent) {
    event.preventDefault();
    setReviewError(null);
    if (!rationale.trim()) {
      setReviewError("Enter a rationale for this decision.");
      return;
    }
    setReviewing(true);
    const result = await sendRequest("POST", `/ai-impact-assessments/${current.id}/review`, { decision, rationale });
    setReviewing(false);
    if (result) {
      setReviewError(result);
      return;
    }
    setRationale("");
    reload();
  }

  const summaryItems: { label: string; value: number | string }[] = [
    { label: "Total impacts", value: summary.totalImpacts },
    { label: "Beneficial", value: summary.beneficialImpacts },
    { label: "Adverse", value: summary.adverseImpacts },
    { label: "Major or severe adverse", value: summary.majorOrSevereAdverseImpacts },
    { label: "Involve vulnerable populations", value: summary.vulnerablePopulationImpacts },
    { label: "Difficult or impossible to reverse", value: summary.difficultOrIrreversibleImpacts },
  ];

  return (
    <main style={pageStyle}>
      <a href={`/ai-systems/${current.aiSystem.id}`} style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        Back to {current.aiSystem.name}
      </a>
      <h1 style={{ fontSize: 26, marginTop: 12, marginBottom: 4 }}>
        {current.name} (version {current.version})
      </h1>
      <p style={{ color: colors.muted, fontStyle: "italic", marginTop: 0, marginBottom: 24 }}>
        AI supports the analysis. People own the judgment.
      </p>

      {locked && (
        <div role="status" style={{ ...cardStyle, borderColor: colors.beneficial }}>
          <strong style={{ color: colors.beneficial }}>Approved and locked.</strong>{" "}
          <span style={{ color: colors.soft }}>
            This version is the authoritative record and can no longer be changed. To record changes, start a new version
            from the AI system page.
          </span>
        </div>
      )}

      <section style={cardStyle}>
        <h2 style={headingStyle}>Overview</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginTop: 12 }}>
          <Detail label="Status">{locked ? "Completed (approved)" : readable(current.status)}</Detail>
          <Detail label="Version">{current.version}</Detail>
          <Detail label="Assessor">{current.assessor?.displayName ?? "Not assigned"}</Detail>
          <Detail label="AI system">{current.aiSystem.name}</Detail>
        </div>

        {!locked && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
            <select
              aria-label="Assessment status"
              style={{ ...inputStyle, width: "auto" }}
              value={statusChoice}
              onChange={(e) => setStatusChoice(e.target.value)}
            >
              {EDITABLE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {readable(value)}
                </option>
              ))}
            </select>
            <button type="button" style={quietButtonStyle} onClick={updateStatus} disabled={statusChoice === current.status}>
              Update status
            </button>
          </div>
        )}
        <ErrorText message={statusError} />

        <div style={{ ...insetStyle, marginTop: 16 }}>
          <div style={{ fontSize: 13, color: colors.soft, marginBottom: 10 }}>
            AI system classification, shown for context. This assessment does not change it.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <Detail label="Impact level">{readable(current.aiSystem.impactLevel)}</Detail>
            <Detail label="Human oversight">{readable(current.aiSystem.humanOversight)}</Detail>
            <Detail label="Decision role">{readable(current.aiSystem.decisionRole)}</Detail>
            <Detail label="Affects people outside the organization">
              {current.aiSystem.externalImpact === null ? "Not set" : current.aiSystem.externalImpact ? "Yes" : "No"}
            </Detail>
            <Detail label="Affected population">
              {current.aiSystem.affectedPopulation.length > 0 ? current.aiSystem.affectedPopulation.map(readable).join(", ") : "Not set"}
            </Detail>
            <Detail label="Regulatory relevance">
              {current.aiSystem.regulatoryRelevance.length > 0 ? current.aiSystem.regulatoryRelevance.map(readable).join(", ") : "Not set"}
            </Detail>
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Impact summary</h2>
        <p style={introStyle}>Counts only. There is no overall impact score.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          {summaryItems.map((item) => (
            <div key={item.label} style={insetStyle}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{item.value}</div>
              <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{item.label}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: colors.soft, marginBottom: 0 }}>
          Highest adverse severity:{" "}
          {summary.highestAdverseSeverity
            ? `${summary.highestAdverseSeverity} - ${SEVERITY_LABELS[summary.highestAdverseSeverity]}`
            : "No adverse impacts recorded"}
        </p>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Affected populations</h2>
        <p style={introStyle}>Who this system could affect, based on the impacts recorded below.</p>
        {populationGroups.length === 0 && <p style={{ color: colors.muted }}>No impacts recorded yet.</p>}
        <div style={{ display: "grid", gap: 10 }}>
          {populationGroups.map((group) => {
            const adverse = group.impacts.filter((impact) => impact.direction === "ADVERSE").length;
            const vulnerable = group.impacts.some((impact) => impact.vulnerablePopulations);
            const details = Array.from(
              new Set(group.impacts.map((impact) => impact.affectedGroupDescription).filter((value): value is string => Boolean(value))),
            );
            return (
              <div key={group.population} style={insetStyle}>
                <strong>{readable(group.population)}</strong>
                {details.length > 0 && <span style={{ color: colors.soft }}>: {details.join("; ")}</span>}
                <div style={{ fontSize: 13, color: colors.muted, marginTop: 6 }}>
                  {group.impacts.length} impacts ({adverse} adverse, {group.impacts.length - adverse} beneficial)
                  {vulnerable ? ". Includes vulnerable or sensitive populations." : "."}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Identified impacts</h2>
        <p style={introStyle}>
          Each impact records who is affected, what could happen, whether it helps or harms, how severe and broad it could be,
          and whether it can be undone.
        </p>
        {current.impacts.length === 0 && <p style={{ color: colors.muted }}>No impacts recorded yet.</p>}
        {current.impacts.map((impact) => (
          <ImpactCard key={impact.id} impact={impact} locked={locked} onChanged={reload} />
        ))}

        {!locked && (
          <div style={{ ...insetStyle, borderStyle: "dashed", marginTop: 8 }}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>Add an impact</h3>
            <ImpactForm
              submitLabel="Add impact"
              onSubmit={async (payload) => {
                const result = await sendRequest("POST", `/ai-impact-assessments/${current.id}/impacts`, payload);
                if (!result) {
                  reload();
                }
                return result;
              }}
            />
          </div>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Human oversight and safeguards</h2>
        <p style={introStyle}>Oversight and safeguards documented for each adverse impact.</p>
        {adverseImpacts.length === 0 && <p style={{ color: colors.muted }}>No adverse impacts recorded.</p>}
        <div style={{ display: "grid", gap: 10 }}>
          {adverseImpacts.map((impact) => (
            <div key={impact.id} style={insetStyle}>
              <strong>{impact.title}</strong>
              <span style={{ color: colors.muted }}>
                {" "}
                (severity {impact.severity} - {SEVERITY_LABELS[impact.severity]})
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 10 }}>
                <Detail label="Human oversight">{readable(impact.oversightRequirement)}</Detail>
                <Detail label="Human can review or override">
                  {impact.humanCanOverride === null ? "Not set" : impact.humanCanOverride ? "Yes" : "No"}
                </Detail>
                <Detail label="Escalation path">{impact.escalationMechanism ?? "Not documented"}</Detail>
                <Detail label="Safeguards">
                  {impact.safeguards ?? <span style={{ color: colors.adverse }}>None documented</span>}
                </Detail>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={headingStyle}>Human review</h2>
        <p style={introStyle}>
          An independent reviewer authorizes this assessment. The assessor cannot review their own work, and an approved
          decision cannot be overwritten.
        </p>

        {current.reviewDecision ? (
          <div style={{ ...insetStyle, marginBottom: 16 }}>
            <strong>{readable(current.reviewDecision)}</strong>
            <div style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>
              by {current.reviewer?.displayName ?? "Unknown reviewer"}
              {current.reviewedAt ? ` on ${new Date(current.reviewedAt).toLocaleDateString()}` : ""}
            </div>
            {current.reviewRationale && <p style={{ marginBottom: 0 }}>{current.reviewRationale}</p>}
          </div>
        ) : (
          <p style={{ color: colors.muted }}>No review decision has been recorded yet.</p>
        )}

        {!locked && (
          <form onSubmit={submitReview}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 12 }}>
              <Field label="Decision">
                <select style={inputStyle} value={decision} onChange={(e) => setDecision(e.target.value)}>
                  <option value="APPROVED">Approve</option>
                  <option value="REJECTED">Reject</option>
                  <option value="CHANGES_REQUESTED">Request changes</option>
                </select>
              </Field>
              <Field label="Rationale">
                <input
                  style={inputStyle}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Reasoning for this decision"
                />
              </Field>
            </div>
            <ErrorText message={reviewError} />
            <button type="submit" disabled={reviewing} style={buttonStyle}>
              {reviewing ? "Submitting..." : "Submit review decision"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}