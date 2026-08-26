"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type FactorContribution = {
  factor: string;
  weight: number;
  value: number;
  contribution: number;
  wasProvided: boolean;
};

type RiskRatingResult = {
  inherent: {
    score: number;
    factors: FactorContribution[];
    weights: Record<string, number>;
    missingInputs: string[];
    assumptions: string[];
  };
  controlEffectiveness: number;
  residualScore: number;
  finalRating: string;
};

const FACTOR_LABELS: Record<string, string> = {
  businessCriticality: "Business Criticality",
  dataSensitivity: "Data Sensitivity",
  aiAutonomy: "AI Autonomy",
  regulatoryExposure: "Regulatory Exposure",
  securityPosture: "Security Posture",
  modelRisk: "Model Risk",
  vendorMaturity: "Vendor Maturity",
};

const BAND_COLORS: Record<string, string> = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
};

export default function RiskRatingPage() {
  const params = useParams();
  const assessmentId = params.id as string;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [controlEffectiveness, setControlEffectiveness] = useState("0");
  const [result, setResult] = useState<RiskRatingResult | null>(null);
  const [calculating, setCalculating] = useState(false);

  function setInput(key: string, value: string) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  async function calculate() {
    setCalculating(true);
    const body: Record<string, number> = {};
    for (const key of Object.keys(FACTOR_LABELS)) {
      const raw = inputs[key];
      if (raw !== undefined && raw !== "") body[key] = Number(raw);
    }
    body.controlEffectiveness = Number(controlEffectiveness) / 100;

    const res = await fetch(`${apiUrl}/assessments/${assessmentId}/risk-rating`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setResult(data.result);
    }
    setCalculating(false);
  }

  const bandColor = result ? BAND_COLORS[result.finalRating] ?? "#5d6786" : "#5d6786";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Configurable AI Risk Rating</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        Enter each factor (0-100) and a control effectiveness percentage, then calculate to see the
        full weighted breakdown - every number below is shown, not hidden.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        {Object.entries(FACTOR_LABELS).map(([key, label]) => (
          <div
            key={key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "10px 16px",
            }}
          >
            <span style={{ fontSize: 14 }}>{label}</span>
            <input
              type="number"
              min={0}
              max={100}
              value={inputs[key] ?? ""}
              onChange={(e) => setInput(key, e.target.value)}
              placeholder="0-100"
              style={{
                width: 80,
                background: "#141b2d",
                color: "#c3cad9",
                border: "1px solid #2e3d63",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 13,
              }}
            />
          </div>
        ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#1a2340",
            border: "1px solid #3b82f6",
            borderRadius: 10,
            padding: "10px 16px",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>Control Effectiveness (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            value={controlEffectiveness}
            onChange={(e) => setControlEffectiveness(e.target.value)}
            style={{
              width: 80,
              background: "#141b2d",
              color: "#c3cad9",
              border: "1px solid #2e3d63",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 13,
            }}
          />
        </div>
      </div>

      <button
        disabled={calculating}
        onClick={calculate}
        style={{
          background: "#3b82f6",
          color: "#000",
          border: "none",
          borderRadius: 8,
          padding: "10px 18px",
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 28,
        }}
      >
        Calculate Risk Rating
      </button>

      {result && (
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>How this score was calculated</h2>

          <div
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 16,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
              Stage 1 - Inherent Risk (weighted sum of all factors)
            </div>
            {result.inherent.factors.map((f) => (
              <div
                key={f.factor}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  padding: "4px 0",
                  color: f.wasProvided ? "#c3cad9" : "#8b96ac",
                }}
              >
                <span>
                  {FACTOR_LABELS[f.factor] ?? f.factor}
                  {!f.wasProvided && " (missing, treated as 0)"}
                </span>
                <span>
                  {f.value} &times; {(f.weight * 100).toFixed(0)}% = {f.contribution.toFixed(2)}
                </span>
              </div>
            ))}
            <div
              style={{
                borderTop: "1px solid #2e3d63",
                marginTop: 8,
                paddingTop: 8,
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              Inherent Risk Score: {result.inherent.score.toFixed(2)}
            </div>
          </div>

          <div
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Stage 2 - Control Effectiveness</div>
            <div>{(result.controlEffectiveness * 100).toFixed(0)}% of inherent risk is mitigated by existing controls.</div>
          </div>

          <div
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "16px 20px",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>
              Stage 3 - Residual Risk = Inherent &times; (1 - Control Effectiveness)
            </div>
            <div>
              {result.inherent.score.toFixed(2)} &times; (1 - {result.controlEffectiveness.toFixed(2)}) ={" "}
              {result.residualScore.toFixed(2)}
            </div>
          </div>

          <div
            style={{
              background: "#1a2340",
              border: `2px solid ${bandColor}`,
              borderRadius: 10,
              padding: "16px 20px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 13, color: "#8b96ac", marginBottom: 4 }}>Stage 4 - Final Risk Rating</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: bandColor }}>{result.finalRating}</div>
          </div>

          {result.inherent.assumptions.length > 0 && (
            <div style={{ marginTop: 16, fontSize: 12, color: "#8b96ac" }}>
              {result.inherent.assumptions.map((a, i) => (
                <div key={i}>{a}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}