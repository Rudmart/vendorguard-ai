"use client";
import { useState } from "react";

const CATEGORIES = ["GENERATIVE", "PREDICTIVE_ML", "DECISION_SUPPORT", "EMBEDDED", "AGENT", "OTHER"];
const DATA_CATEGORY_OPTIONS = ["PII", "FINANCIAL", "HEALTH", "BIOMETRIC", "CHILDREN", "OTHER"];
const RISK_TIERS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export default function AddAiSystemForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [origin, setOrigin] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [dataCategories, setDataCategories] = useState<string[]>([]);
  const [riskTier, setRiskTier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggleDataCategory(cat: string) {
    setDataCategories((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || undefined,
          origin,
          category,
          dataCategories,
          riskTier: riskTier || undefined,
        }),
      });

      if (res.status === 403) {
        setError("You don't have permission to register an AI system.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || "Something went wrong. Please try again.");
        return;
      }

      setName("");
      setDescription("");
      setOrigin("");
      setCategory("OTHER");
      setDataCategories([]);
      setRiskTier("");
      onCreated();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #233150",
    background: "#0a0f1a",
    color: "#e9edf6",
    fontSize: 14,
    marginTop: 4,
    marginBottom: 16,
  };

  const labelStyle = { fontSize: 13, color: "#8b96ac" };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ background: "#111a2b", border: "1px solid #233150", borderRadius: 10, padding: 20, marginBottom: 32 }}
    >
      <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Register AI System</h2>

      <label style={labelStyle}>
        Name
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} required />
      </label>

      <label style={labelStyle}>
        Description
        <input style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>

      <label style={labelStyle}>
        Origin
        <select style={inputStyle} value={origin} onChange={(e) => setOrigin(e.target.value)} required>
          <option value="">Select origin...</option>
          <option value="INTERNAL">Internal - AI developed or operated by your organization</option>
          <option value="THIRD_PARTY">Third Party - AI capability primarily provided by an external organization</option>
        </select>
      </label>

      <label style={labelStyle}>
        Category
        <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Risk Tier
        <select style={inputStyle} value={riskTier} onChange={(e) => setRiskTier(e.target.value)}>
          <option value="">Not set</option>
          {RISK_TIERS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <div style={{ marginBottom: 16 }}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Data Categories</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {DATA_CATEGORY_OPTIONS.map((cat) => (
            <label key={cat} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8b96ac" }}>
              <input type="checkbox" checked={dataCategories.includes(cat)} onChange={() => toggleDataCategory(cat)} />
              {cat}
            </label>
          ))}
        </div>
      </div>

      {error && <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "10px 18px",
          fontSize: 14,
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Registering..." : "Register AI System"}
      </button>
    </form>
  );
}