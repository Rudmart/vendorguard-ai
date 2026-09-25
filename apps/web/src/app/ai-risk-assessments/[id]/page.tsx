"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const LIKELIHOOD_LABELS: Record<number, string> = { 1: "Rare", 2: "Unlikely", 3: "Possible", 4: "Likely", 5: "Almost Certain" };
const IMPACT_LABELS: Record<number, string> = { 1: "Insignificant", 2: "Minor", 3: "Moderate", 4: "Major", 5: "Severe" };
const CATEGORIES = ["DATA", "PRIVACY", "FAIRNESS", "TRANSPARENCY", "RELIABILITY", "SAFETY", "SECURITY", "HUMAN_OVERSIGHT", "THIRD_PARTY", "LEGAL_COMPLIANCE", "OPERATIONAL"];
const CONTROL_EFFECTIVENESS_OPTIONS = ["NOT_ASSESSED", "INEFFECTIVE", "PARTIALLY_EFFECTIVE", "EFFECTIVE"];
const TREATMENT_OPTIONS = ["ACCEPT", "MITIGATE", "AVOID", "TRANSFER"];
const REVIEW_DECISIONS = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"];

const RATING_COLORS: Record<string, string> = { LOW: "#22c55e", MODERATE: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };

type Risk = {
  id: string;
  title: string;
  category: string;
  statement: string;
  likelihood: number;
  impact: number;
  inherentScore: number;
  inherentRating: string | null;
  existingControls: string | null;
  controlId: string | null;
  control: { title: string } | null;
  controlEffectiveness: string;
  residualLikelihood: number | null;
  residualImpact: number | null;
  residualScore: number | null;
  residualRating: string | null;
  treatment: string | null;
  treatmentRationale: string | null;
};

type AssessmentDetail = {
  id: string;
  name: string;
  status: string;
  version: number;
  assessor: { displayName: string } | null;
  reviewer: { displayName: string } | null;
  reviewDecision: string | null;
  reviewRationale: string | null;
  reviewedAt: string | null;
  risks: Risk[];
};

function RatingBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span style={{ color: "#5d6786", fontSize: 11.5 }}>Not set</span>;
  const color = RATING_COLORS[rating] || "#8b96ac";
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 9px" }}>
      {rating}
    </span>
  );
}

function RiskCard({ risk, onUpdate }: { risk: Risk; onUpdate: () => void }) {
  const [existingControls, setExistingControls] = useState(risk.existingControls || "");
  const [controlEffectiveness, setControlEffectiveness] = useState(risk.controlEffectiveness || "NOT_ASSESSED");
  const [residualLikelihood, setResidualLikelihood] = useState(risk.residualLikelihood || "");
  const [residualImpact, setResidualImpact] = useState(risk.residualImpact || "");
  const [treatment, setTreatment] = useState(risk.treatment || "");
  const [treatmentRationale, setTreatmentRationale] = useState(risk.treatmentRationale || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-risks/${risk.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          existingControls: existingControls || undefined,
          controlEffectiveness,
          residualLikelihood: residualLikelihood === "" ? undefined : Number(residualLikelihood),
          residualImpact: residualImpact === "" ? undefined : Number(residualImpact),
          treatment: treatment || null,
          treatmentRationale: treatmentRationale || undefined,
        }),
      });
      if (res.status === 403) {
        setError("You don't have permission to update this risk.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Something went wrong saving this risk.");
        return;
      }
      onUpdate();
    } catch {
      setError("Something went wrong saving this risk.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-risks/${risk.id}`, { method: "DELETE", credentials: "include" });
    onUpdate();
  }

  const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #2e3d63", background: "#0a0f1a", color: "#e6e9f0", fontSize: 13, width: "100%" };
  const labelStyle = { fontSize: 12, color: "#8b96ac", display: "block", marginBottom: 4 };

  return (
    <div style={{ background: "#0a0f1a", border: "1px solid #233150", borderRadius: 10, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{risk.title}</div>
          <div style={{ fontSize: 11.5, color: "#8b96ac", textTransform: "uppercase" as const, letterSpacing: 0.5, marginTop: 2 }}>{risk.category.replace(/_/g, " ")}</div>
        </div>
        <button onClick={handleDelete} style={{ background: "none", border: "1px solid #5d6786", color: "#8b96ac", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>
          Delete
        </button>
      </div>
      <p style={{ fontSize: 13, color: "#c5cbdb", marginBottom: 14 }}>{risk.statement}</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16, background: "#111a2b", border: "1px solid #233150", borderRadius: 8, padding: 12 }}>
        <div>
          <div style={labelStyle}>Likelihood</div>
          <div style={{ fontSize: 13 }}>{risk.likelihood} - {LIKELIHOOD_LABELS[risk.likelihood]}</div>
        </div>
        <div>
          <div style={labelStyle}>Impact</div>
          <div style={{ fontSize: 13 }}>{risk.impact} - {IMPACT_LABELS[risk.impact]}</div>
        </div>
        <div>
          <div style={labelStyle}>Inherent Risk</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13 }}>{risk.inherentScore}</span>
            <RatingBadge rating={risk.inherentRating} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={labelStyle}>Existing Controls</div>
        <textarea
          value={existingControls}
          onChange={(e) => setExistingControls(e.target.value)}
          placeholder="Describe the control(s) in place for this risk..."
          style={{ ...selectStyle, minHeight: 60, resize: "vertical" as const }}
        />
        {risk.control && (
          <div style={{ fontSize: 12, color: "#8b96ac", marginTop: 4 }}>Linked framework control: {risk.control.title}</div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={labelStyle}>Control Effectiveness</div>
          <select style={selectStyle} value={controlEffectiveness} onChange={(e) => setControlEffectiveness(e.target.value)}>
            {CONTROL_EFFECTIVENESS_OPTIONS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Residual Likelihood</div>
          <select style={selectStyle} value={residualLikelihood} onChange={(e) => setResidualLikelihood(e.target.value)}>
            <option value="">Not set</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {LIKELIHOOD_LABELS[n]}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Residual Impact</div>
          <select style={selectStyle} value={residualImpact} onChange={(e) => setResidualImpact(e.target.value)}>
            <option value="">Not set</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {IMPACT_LABELS[n]}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, background: "#111a2b", border: "1px solid #233150", borderRadius: 8, padding: 12 }}>
        <div style={labelStyle}>Residual Risk</div>
        <span style={{ fontSize: 13 }}>{risk.residualScore ?? "Not yet assessed"}</span>
        <RatingBadge rating={risk.residualRating} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={labelStyle}>Treatment</div>
          <select style={selectStyle} value={treatment} onChange={(e) => setTreatment(e.target.value)}>
            <option value="">Not decided</option>
            {TREATMENT_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Treatment Rationale</div>
          <input style={selectStyle} value={treatmentRationale} onChange={(e) => setTreatmentRationale(e.target.value)} placeholder="Why this treatment decision..." />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12.5, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
      >
        {saving ? "Saving..." : "Save Risk"}
      </button>
      {error && (
        <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 12, marginTop: 8 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export default function AiRiskAssessmentPage() {
  const params = useParams();
  const id = params?.id as string;

  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("OPERATIONAL");
  const [statement, setStatement] = useState("");
  const [likelihood, setLikelihood] = useState("3");
  const [impact, setImpact] = useState("3");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  const [reviewDecision, setReviewDecision] = useState("APPROVED");
  const [reviewRationale, setReviewRationale] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [reviewing, setReviewing] = useState(false);

  function loadAssessment() {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-risk-assessments/${id}`, { credentials: "include" })
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d) => {
        if (d) setAssessment(d);
      })
      .catch(() => setNotFound(true));
  }

  useEffect(() => {
    if (!id) return;
    loadAssessment();
  }, [id]);

  async function handleAddRisk(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-risk-assessments/${id}/risks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, statement, likelihood: Number(likelihood), impact: Number(impact) }),
      });
      if (res.status === 403) {
        setAddError("You don't have permission to add risks to this assessment.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAddError(body?.error || "Something went wrong adding this risk.");
        return;
      }
      setTitle("");
      setStatement("");
      setLikelihood("3");
      setImpact("3");
      loadAssessment();
    } catch {
      setAddError("Something went wrong adding this risk.");
    } finally {
      setAdding(false);
    }
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    setReviewing(true);
    setReviewError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-risk-assessments/${id}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: reviewDecision, rationale: reviewRationale }),
      });
      if (res.status === 403) {
        const body = await res.json().catch(() => null);
        setReviewError(body?.error || "You don't have permission to review this assessment.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setReviewError(body?.error || "Something went wrong recording the review.");
        return;
      }
      setReviewRationale("");
      loadAssessment();
    } catch {
      setReviewError("Something went wrong recording the review.");
    } finally {
      setReviewing(false);
    }
  }

  if (notFound) {
    return (
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24 }}>Risk assessment not found</h1>
        <p style={{ color: "#8b96ac", fontSize: 13.5 }}>This assessment doesn&apos;t exist, or you don&apos;t have access to it.</p>
      </main>
    );
  }

  if (!assessment) {
    return (
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <p style={{ color: "#8b96ac", fontSize: 13.5 }}>Loading...</p>
      </main>
    );
  }

  const risks = assessment.risks || [];
  const summary = { CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  let highestInherent = 0;
  let highestResidual = 0;
  for (const r of risks) {
    if (r.inherentRating && summary[r.inherentRating as keyof typeof summary] !== undefined) summary[r.inherentRating as keyof typeof summary]++;
    if (r.inherentScore > highestInherent) highestInherent = r.inherentScore;
    if (r.residualScore && r.residualScore > highestResidual) highestResidual = r.residualScore;
  }

  const cardStyle = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 };
  const selectStyle = { padding: "9px 12px", borderRadius: 8, border: "1px solid #2e3d63", background: "#0a0f1a", color: "#e6e9f0", fontSize: 13, width: "100%" };
  const labelStyle = { fontSize: 13, color: "#8b96ac", display: "block", marginBottom: 4 };

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{assessment.name}</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24, fontStyle: "italic" }}>AI assists. Humans govern.</p>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Assessment Overview</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <div style={labelStyle}>Status</div>
            <div style={{ fontSize: 14 }}>{assessment.status.replace(/_/g, " ")}</div>
          </div>
          <div>
            <div style={labelStyle}>Assessor</div>
            <div style={{ fontSize: 14 }}>{assessment.assessor ? assessment.assessor.displayName : "Not assigned"}</div>
          </div>
          <div>
            <div style={labelStyle}>Version</div>
            <div style={{ fontSize: 14 }}>{assessment.version}</div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Risk Summary</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as const).map((band) => (
            <div key={band} style={{ background: "#0a0f1a", border: "1px solid #233150", borderRadius: 8, padding: "12px", textAlign: "center" as const }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: RATING_COLORS[band] }}>{summary[band]}</div>
              <div style={{ fontSize: 10.5, color: "#8b96ac", textTransform: "uppercase" as const }}>{band}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 13, color: "#8b96ac" }}>
          <div>Total risks: <strong style={{ color: "#e6e9f0" }}>{risks.length}</strong></div>
          <div>Highest inherent: <strong style={{ color: "#e6e9f0" }}>{highestInherent || "N/A"}</strong></div>
          <div>Highest residual: <strong style={{ color: "#e6e9f0" }}>{highestResidual || "N/A"}</strong></div>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Identified Risks</h2>
        {risks.map((risk: Risk) => (
          <RiskCard key={risk.id} risk={risk} onUpdate={loadAssessment} />
        ))}

        <form onSubmit={handleAddRisk} style={{ background: "#0a0f1a", border: "1px dashed #2e3d63", borderRadius: 10, padding: 16 }}>
          <h3 style={{ fontSize: 13.5, marginTop: 0, marginBottom: 12 }}>Add a Risk</h3>
          <label style={labelStyle}>
            Risk Title
            <input style={{ ...selectStyle, marginBottom: 10 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sensitive Data Exposure" required />
          </label>
          <label style={labelStyle}>
            Category
            <select style={{ ...selectStyle, marginBottom: 10 }} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Risk Statement
            <textarea
              style={{ ...selectStyle, marginBottom: 10, minHeight: 60, resize: "vertical" as const }}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Because [condition/cause], there is a risk that [risk event], which could result in [impact]."
              required
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label style={labelStyle}>
              Likelihood
              <select style={selectStyle} value={likelihood} onChange={(e) => setLikelihood(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {LIKELIHOOD_LABELS[n]}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Impact
              <select style={selectStyle} value={impact} onChange={(e) => setImpact(e.target.value)}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} - {IMPACT_LABELS[n]}</option>)}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={adding}
            style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: adding ? "not-allowed" : "pointer" }}
          >
            {adding ? "Adding..." : "Add Risk"}
          </button>
          {addError && (
            <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 12, marginTop: 10 }}>
              {addError}
            </div>
          )}
        </form>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Human Review</h2>
        <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
          AI assists with analysis; a human reviewer authorizes this assessment. The assessor cannot review their own work.
        </p>

        {assessment.reviewDecision ? (
          <div style={{ background: "#0a0f1a", border: "1px solid #233150", borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{assessment.reviewDecision}</div>
            <div style={{ fontSize: 12.5, color: "#8b96ac", marginTop: 4 }}>
              by {assessment.reviewer ? assessment.reviewer.displayName : "Unknown"} on {assessment.reviewedAt ? new Date(assessment.reviewedAt).toLocaleDateString() : ""}
            </div>
            <div style={{ fontSize: 13, marginTop: 8 }}>{assessment.reviewRationale}</div>
          </div>
        ) : (
          <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 16 }}>No review decision has been recorded yet.</p>
        )}

        <form onSubmit={handleSubmitReview}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12, marginBottom: 12 }}>
            <label style={labelStyle}>
              Decision
              <select style={selectStyle} value={reviewDecision} onChange={(e) => setReviewDecision(e.target.value)}>
                {REVIEW_DECISIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Rationale
              <input style={selectStyle} value={reviewRationale} onChange={(e) => setReviewRationale(e.target.value)} placeholder="Reasoning for this decision..." required />
            </label>
          </div>
          <button
            type="submit"
            disabled={reviewing}
            style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: reviewing ? "not-allowed" : "pointer" }}
          >
            {reviewing ? "Submitting..." : "Submit Review Decision"}
          </button>
          {reviewError && (
            <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "8px 12px", color: "#f87171", fontSize: 12, marginTop: 10 }}>
              {reviewError}
            </div>
          )}
        </form>
      </div>
    </main>
  );
}