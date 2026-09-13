"use client";
import { useState, useEffect } from "react";

interface PendingFinding {
  id: string;
  status: string;
  confidence: number | null;
  gaps: string[];
  recommendations: string[];
  createdAt: string;
  vendor: { id: string; legalName: string };
  assessment: { id: string };
  control: { id: string; controlId: string; title: string };
}

const DECISIONS = [
  { value: "ACCEPT", label: "Accept" },
  { value: "REJECT", label: "Reject" },
  { value: "OVERRIDE", label: "Override" },
  { value: "REQUEST_MORE_EVIDENCE", label: "Request more evidence" },
  { value: "NOT_APPLICABLE", label: "Not applicable" },
];

export default function ReviewQueuePage() {
  const [findings, setFindings] = useState<PendingFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  useEffect(() => {
    loadQueue();
  }, []);

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reviews/findings`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError("Could not load the review queue.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setFindings(data.findings ?? []);
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
  }

  async function submitDecision(finding: PendingFinding) {
    const decision = decisions[finding.id];
    const rationale = rationales[finding.id];
    if (!decision) {
      alert("Choose a decision first.");
      return;
    }
    if (!rationale || !rationale.trim()) {
      alert("A rationale is required.");
      return;
    }
    setSubmitting(finding.id);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/assessments/${finding.assessment.id}/findings/${finding.id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ decision, rationale }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Could not submit the decision.");
        setSubmitting(null);
        return;
      }
      setFindings((prev) => prev.filter((f) => f.id !== finding.id));
    } catch {
      alert("Could not reach the server.");
    }
    setSubmitting(null);
  }

  if (loading) {
    return <div style={{ padding: 32, color: "#8b96ac" }}>Loading review queue...</div>;
  }

  if (forbidden) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pending Reviews</h1>
        <div style={{ color: "#f59e0b", fontSize: 14 }}>
          Your role does not have authority to review findings. Contact an administrator if you believe this is incorrect.
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Pending Reviews</h1>
        <div style={{ color: "#dc2626", fontSize: 14 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Pending Reviews</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {findings.length} finding{findings.length === 1 ? "" : "s"} awaiting human review.
      </p>

      {findings.length === 0 && (
        <div style={{ color: "#8b96ac", fontSize: 14, marginTop: 40 }}>
          Nothing is currently pending review.
        </div>
      )}

      {findings.map((finding) => (
        <div
          key={finding.id}
          style={{
            background: "#1a2340",
            border: "1px solid #2e3d63",
            borderRadius: 10,
            marginBottom: 20,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #2e3d63" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{finding.vendor.legalName}</div>
            <div style={{ fontSize: 12, color: "#8b96ac" }}>
              {finding.control.controlId} - {finding.control.title}
            </div>
          </div>

          <div style={{ padding: "16px 20px", borderBottom: "1px solid #2e3d63" }}>
            <div style={{ fontSize: 11, color: "#8b96ac", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
              AI Recommendation (read-only)
            </div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              Status: <span style={{ fontFamily: "monospace" }}>{finding.status}</span>
              {finding.confidence !== null && (
                <span style={{ color: "#8b96ac" }}> - Confidence: {Math.round(finding.confidence * 100)}%</span>
              )}
            </div>
            {finding.gaps.length > 0 && (
              <div style={{ fontSize: 13, marginBottom: 6 }}>
                <strong>Gaps:</strong> {finding.gaps.join("; ")}
              </div>
            )}
            {finding.recommendations.length > 0 && (
              <div style={{ fontSize: 13 }}>
                <strong>Recommendations:</strong> {finding.recommendations.join("; ")}
              </div>
            )}
          </div>

          <div style={{ padding: "16px 20px" }}>
            <div style={{ fontSize: 11, color: "#8b96ac", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
              Human Review
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              {DECISIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDecisions((prev) => ({ ...prev, [finding.id]: d.value }))}
                  style={{
                    background: decisions[finding.id] === d.value ? "#3b82f6" : "#141b2d",
                    color: decisions[finding.id] === d.value ? "#fff" : "#8b96ac",
                    border: "1px solid #2e3d63",
                    borderRadius: 8,
                    padding: "6px 12px",
                    fontSize: 12.5,
                    cursor: "pointer",
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <textarea
              placeholder="Rationale (required)"
              value={rationales[finding.id] ?? ""}
              onChange={(e) => setRationales((prev) => ({ ...prev, [finding.id]: e.target.value }))}
              style={{
                width: "100%",
                minHeight: 60,
                background: "#141b2d",
                border: "1px solid #2e3d63",
                borderRadius: 8,
                padding: "8px 12px",
                color: "#e5e9f0",
                fontSize: 13,
                marginBottom: 10,
                resize: "vertical",
              }}
            />
            <button
              onClick={() => submitDecision(finding)}
              disabled={submitting === finding.id}
              style={{
                background: "#3b82f6",
                border: "none",
                borderRadius: 8,
                padding: "8px 18px",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: submitting === finding.id ? "not-allowed" : "pointer",
                opacity: submitting === finding.id ? 0.6 : 1,
              }}
            >
              {submitting === finding.id ? "Submitting..." : "Submit Decision"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}