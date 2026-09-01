"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type EvidenceDoc = {
  id: string;
  displayFilename: string;
  documentType: string;
  state: string;
  expirationDate: string | null;
};

type Analysis = {
  relevantControlIds: string[];
  gaps: string[];
  recommendations: string[];
  confidence: number;
  expirationDate: string | null;
  summary: string;
};

type Finding = {
  id: string;
  controlId: string;
  status: string;
  confidence: number | null;
  gaps: string[];
  recommendations: string[];
  requiresHumanReview: boolean;
};

const panelStyle = {
  background: "#1a2340",
  border: "1px solid #2e3d63",
  borderRadius: 10,
  padding: 18,
  marginBottom: 20,
};
const labelStyle = { fontWeight: 700, fontSize: 13, marginBottom: 10, textTransform: "uppercase" as const, letterSpacing: 0.5 };

export default function EvidenceAnalysisPage() {
  const params = useParams();
  const assessmentId = params.id as string;
  const evidenceDocumentId = params.evidenceDocumentId as string;

  const [document, setDocument] = useState<EvidenceDoc | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [finalStatus, setFinalStatus] = useState("INSUFFICIENT_EVIDENCE");

  useEffect(() => {
    async function loadDoc() {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/evidence/${evidenceDocumentId}`, {
        credentials: "include",
      });
      if (res.ok) {
        setDocument(await res.json());
      }
      setLoadingDoc(false);
    }
    loadDoc();
  }, [evidenceDocumentId]);

  async function runAnalysis() {
    setAnalyzing(true);
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/assessments/${assessmentId}/evidence/${evidenceDocumentId}/analyze`,
      { method: "POST", credentials: "include" }
    );
    if (res.ok) {
      const data = await res.json();
      setAnalysis(data.analysis);
      setFindings(data.findings);
    }
    setAnalyzing(false);
  }

  async function submitReview(findingId: string, decision: string) {
    if (!rationale) {
      alert("Please enter a rationale before submitting a decision.");
      return;
    }
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/assessments/${assessmentId}/findings/${findingId}/review`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, rationale, finalStatus }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      setFindings((prev) => prev.map((f) => (f.id === findingId ? data.finding : f)));
      setReviewingId(null);
      setRationale("");
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Evidence Analysis</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        AI-assisted review is advisory only - every finding requires human review before it counts as final.
      </p>

      <div style={panelStyle}>
        <div style={labelStyle}>Evidence</div>
        {loadingDoc ? (
          <p style={{ color: "#8b96ac" }}>Loading...</p>
        ) : document ? (
          <>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{document.displayFilename}</div>
            <div style={{ color: "#8b96ac", fontSize: 13, marginTop: 4 }}>
              {document.documentType} &middot; {document.state}
              {document.expirationDate && ` \u00b7 Expires ${new Date(document.expirationDate).toLocaleDateString()}`}
            </div>
          </>
        ) : (
          <p style={{ color: "#e5484d" }}>Evidence document not found.</p>
        )}
      </div>

      {!analysis && (
        <button
          onClick={runAnalysis}
          disabled={analyzing || !document}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 13,
            fontWeight: 700,
            cursor: analyzing ? "default" : "pointer",
            opacity: analyzing ? 0.6 : 1,
            marginBottom: 20,
          }}
        >
          {analyzing ? "Analyzing..." : "Run AI Analysis"}
        </button>
      )}

      {analysis && (
        <>
          <div style={panelStyle}>
            <div style={labelStyle}>AI Analysis (advisory)</div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>{analysis.summary}</div>
            <div style={{ color: "#8b96ac", fontSize: 12, marginBottom: 8 }}>
              Confidence: {(analysis.confidence * 100).toFixed(0)}% &middot; Relevant controls:{" "}
              {analysis.relevantControlIds.join(", ") || "none"}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Gaps identified:</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#c5cbe0" }}>
              {analysis.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Recommendation</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "#c5cbe0" }}>
              {analysis.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          <div style={panelStyle}>
            <div style={labelStyle}>Human Decision</div>
            {findings.length === 0 ? (
              <p style={{ color: "#8b96ac", fontSize: 13 }}>No findings proposed.</p>
            ) : (
              findings.map((f) => (
                <div
                  key={f.id}
                  style={{
                    border: "1px solid #2e3d63",
                    borderRadius: 8,
                    padding: 14,
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    Control: {f.controlId} &middot; Status: {f.status}
                  </div>
                  <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 4 }}>
                    {f.requiresHumanReview ? "Awaiting human review" : "Reviewed"}
                  </div>

                  {f.requiresHumanReview &&
                    (reviewingId === f.id ? (
                      <div style={{ marginTop: 10 }}>
                        <textarea
                          placeholder="Rationale (required)"
                          value={rationale}
                          onChange={(e) => setRationale(e.target.value)}
                          style={{
                            width: "100%",
                            background: "#141b2d",
                            border: "1px solid #2e3d63",
                            borderRadius: 8,
                            padding: "8px 12px",
                            color: "#e5e9f0",
                            fontSize: 13,
                            marginBottom: 8,
                            minHeight: 60,
                          }}
                        />
                        <select
                          value={finalStatus}
                          onChange={(e) => setFinalStatus(e.target.value)}
                          style={{
                            width: "100%",
                            background: "#141b2d",
                            border: "1px solid #2e3d63",
                            borderRadius: 8,
                            padding: "8px 12px",
                            color: "#e5e9f0",
                            fontSize: 13,
                            marginBottom: 10,
                          }}
                        >
                          <option value="PASS">PASS</option>
                          <option value="PARTIAL">PARTIAL</option>
                          <option value="FAIL">FAIL</option>
                          <option value="INSUFFICIENT_EVIDENCE">INSUFFICIENT_EVIDENCE</option>
                          <option value="CONFLICTING_EVIDENCE">CONFLICTING_EVIDENCE</option>
                          <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
                        </select>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={() => submitReview(f.id, "ACCEPT")}
                            style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => submitReview(f.id, "OVERRIDE")}
                            style={{ background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            Override
                          </button>
                          <button
                            onClick={() => submitReview(f.id, "REJECT")}
                            style={{ background: "#e5484d", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setReviewingId(f.id)}
                        style={{ marginTop: 10, background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                      >
                        Review
                      </button>
                    ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </main>
  );
}