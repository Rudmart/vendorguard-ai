"use client";
import { useEffect, useState } from "react";
import { GovernanceInfo, useCurrentUser } from "../../../../current-user";
import { useRouter, useParams } from "next/navigation";



export default function NewAssessmentPage() {
  const router = useRouter();
  const params = useParams();
  const vendorId = params.id as string;
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { can } = useCurrentUser();
  const [frameworks, setFrameworks] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/frameworks/available`, { credentials: "include" }).then(async r => {
      if (!r.ok) throw new Error("Could not load the available framework library");
      const data = await r.json();
      if (active) setFrameworks(data.frameworks.map((f: { frameworkId: string; frameworkName: string }) => ({ id: f.frameworkId, name: f.frameworkName })));
    }).catch(() => { if (active) setError("Could not load the available framework library"); });
    return () => { active = false; };
  }, []);

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
        {frameworks.map((fw) => (
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

      {can("assessment:create") ? (
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
      ) : (
        <GovernanceInfo>Starting an AI vendor assessment requires assessment create permission.</GovernanceInfo>
      )}
    </main>
  );
}
