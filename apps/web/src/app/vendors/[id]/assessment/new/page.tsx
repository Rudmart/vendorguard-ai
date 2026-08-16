"use client";
import { useState } from "react";
import { useRouter, useParams } from "next/navigation";

const AVAILABLE_FRAMEWORKS = [
  { id: "nist-csf-2.0", name: "NIST Cybersecurity Framework 2.0" },
  { id: "iso-27001-2022", name: "ISO/IEC 27001:2022" },
  { id: "nist-ai-rmf", name: "NIST AI Risk Management Framework" },
  { id: "nist-800-161", name: "NIST SP 800-161r1 (Supply Chain)" },
  { id: "ffiec-outsourcing", name: "FFIEC IT Examination Handbook" },
  { id: "glba-safeguards", name: "GLBA Safeguards Rule" },
  { id: "nist-800-66", name: "NIST SP 800-66 (HIPAA)" },
  { id: "iso-22301", name: "ISO 22301 (Business Continuity)" },
];

export default function NewAssessmentPage() {
  const router = useRouter();
  const params = useParams();
  const vendorId = params.id as string;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleStart() {
    if (selected.length === 0) {
      setError("Select at least one framework.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/assessments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frameworkIds: selected }),
      });
      if (!res.ok) {
        setError("Failed to start assessment.");
        setSubmitting(false);
        return;
      }
      const assessment = await res.json();
      router.push(`/assessments/${assessment.id}`);
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Start Assessment</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        Select which frameworks to assess this vendor against.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
        {AVAILABLE_FRAMEWORKS.map((fw) => (
          <label
            key={fw.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "12px 16px",
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={selected.includes(fw.id)}
              onChange={() => toggle(fw.id)}
            />
            {fw.name}
          </label>
        ))}
      </div>

      {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <button
        onClick={handleStart}
        disabled={submitting}
        style={{
          background: "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "11px 22px",
          fontSize: 13.5,
          fontWeight: 700,
          cursor: submitting ? "default" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Starting..." : "Start Assessment"}
      </button>
    </main>
  );
}
