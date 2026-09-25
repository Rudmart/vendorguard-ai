"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type Person = { id: string; displayName: string; email: string } | null;

type FrameworkRow = {
  framework: {
    id: string;
    name: string;
    catalogId: string;
    scope: string;
    tenantSpecific: boolean;
    currentVersion: { id: string; version: string; controlCount: number } | null;
  };
  applicability: { id: string; status: string; rationale: string; determinedAt: string; determinedBy: Person } | null;
  mappedControlCount: number;
  regulatoryContext: string | null;
};

type Payload = {
  aiSystem: { id: string; name: string; regulatoryRelevance: string[] };
  frameworks: FrameworkRow[];
};

const STATUS_OPTIONS = [
  { value: "APPLICABLE", label: "Applicable" },
  { value: "PARTIALLY_APPLICABLE", label: "Partially applicable" },
  { value: "NOT_APPLICABLE", label: "Not applicable" },
  { value: "NEEDS_REVIEW", label: "Needs review" },
];
const STATUS_COLORS: Record<string, string> = {
  APPLICABLE: "#34d399",
  PARTIALLY_APPLICABLE: "#60a5fa",
  NOT_APPLICABLE: "#94a3b8",
  NEEDS_REVIEW: "#fbbf24",
};
const TAG_LABELS: Record<string, string> = {
  EU_AI_ACT: "EU AI Act",
  PRIVACY: "Privacy",
  INDUSTRY_SPECIFIC: "Industry specific",
  OTHER: "Other",
};

const inset: CSSProperties = { background: "#0d1323", border: "1px solid #28324d", borderRadius: 10, padding: 16 };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0d1323",
  color: "inherit",
  border: "1px solid #28324d",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
  fontFamily: "inherit",
};
const button: CSSProperties = {
  background: "#3b82f6",
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};
const quietButton: CSSProperties = { ...button, background: "transparent", border: "1px solid #28324d", color: "#c7d0e3", fontWeight: 500 };

function statusLabel(status: string | undefined): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Not assessed";
}

function FrameworkDecision({ aiSystemId, row, onSaved }: { aiSystemId: string; row: FrameworkRow; onSaved: () => void }) {
  const current = row.applicability;
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(current?.status ?? "NEEDS_REVIEW");
  const [rationale, setRationale] = useState(current?.rationale ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    if (!rationale.trim()) {
      setError("A rationale is required for every framework applicability decision.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/ai-systems/${aiSystemId}/framework-applicability/${row.framework.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rationale }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Could not save this decision (${res.status}).`);
        return;
      }
      setEditing(false);
      onSaved();
    } catch {
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setSaving(false);
    }
  }

  const color = current ? STATUS_COLORS[current.status] ?? "#c7d0e3" : "#8e9ab5";

  return (
    <div style={{ ...inset, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700 }}>{row.framework.name}</div>
          <div style={{ fontSize: 12, color: "#8e9ab5", marginTop: 2 }}>
            {row.framework.currentVersion
              ? `Current version ${row.framework.currentVersion.version}, ${row.framework.currentVersion.controlCount} controls in the library`
              : "No current version in the library"}
            {row.framework.tenantSpecific ? " (your organization)" : ""}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color, fontWeight: 700, fontSize: 14 }}>{statusLabel(current?.status)}</div>
          {current && row.mappedControlCount > 0 && (
            <div style={{ fontSize: 12, color: "#8e9ab5" }}>{row.mappedControlCount} controls mapped</div>
          )}
        </div>
      </div>

      {row.regulatoryContext && (
        <p style={{ fontSize: 12, color: "#fbbf24", margin: "10px 0 0" }}>{row.regulatoryContext}</p>
      )}

      {current && !editing && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div style={{ color: "#c7d0e3" }}>{current.rationale}</div>
          <div style={{ color: "#8e9ab5", fontSize: 12, marginTop: 4 }}>
            Decided by {current.determinedBy?.displayName ?? "unknown user"} on {new Date(current.determinedAt).toLocaleDateString()}
          </div>
        </div>
      )}

      {editing ? (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <label style={{ fontSize: 13 }}>
            Applicability decision
            <select style={{ ...input, marginTop: 6 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            Rationale (required)
            <textarea
              style={{ ...input, minHeight: 60, marginTop: 6 }}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Why this framework does, partly does, or does not apply to this AI system"
            />
          </label>
          {error && (
            <p role="alert" style={{ color: "#f87171", fontSize: 13, margin: 0 }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={button} onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save decision"}
            </button>
            <button type="button" style={quietButton} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <button type="button" style={quietButton} onClick={() => setEditing(true)}>
            {current ? "Edit decision" : "Record decision"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function FrameworkApplicabilityCard({ aiSystemId }: { aiSystemId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!aiSystemId) {
      return;
    }
    let cancelled = false;
    fetch(`${API}/ai-systems/${aiSystemId}/framework-applicability`, { credentials: "include" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? `Could not load framework applicability (${res.status}).`);
          return;
        }
        setError(null);
        setPayload(data as Payload);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the server. Check that the API is running.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiSystemId, reloadKey]);

  const rows = payload?.frameworks ?? [];
  const count = (status: string) => rows.filter((row) => row.applicability?.status === status).length;
  const notAssessed = rows.filter((row) => !row.applicability).length;
  const tags = payload?.aiSystem.regulatoryRelevance ?? [];

  return (
    <div style={{ background: "#161e33", border: "1px solid #28324d", borderRadius: 12, padding: 24, marginTop: 24 }}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Framework Applicability</h2>
      <p style={{ color: "#8e9ab5", fontSize: 13, marginTop: 0 }}>
        Which frameworks from the library apply to this AI system, and why. Each decision is made and justified by a person.
        VendorGuard does not determine legal applicability.
      </p>

      {tags.length > 0 && (
        <p style={{ fontSize: 13, color: "#c7d0e3" }}>
          Regulatory relevance recorded for this AI system (context only, not a legal determination):{" "}
          {tags.map((tag) => TAG_LABELS[tag] ?? tag).join(", ")}
        </p>
      )}

      {payload && (
        <p style={{ fontSize: 13, color: "#c7d0e3" }}>
          {count("APPLICABLE")} applicable, {count("PARTIALLY_APPLICABLE")} partially applicable, {count("NEEDS_REVIEW")} needs review,{" "}
          {count("NOT_APPLICABLE")} not applicable, {notAssessed} not assessed.
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}
      {!payload && !error && <p style={{ color: "#8e9ab5" }}>Loading frameworks...</p>}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {rows.map((row) => (
          <FrameworkDecision key={row.framework.id} aiSystemId={aiSystemId} row={row} onSaved={() => setReloadKey((k) => k + 1)} />
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <a href={`/ai-systems/${aiSystemId}/controls`} style={button}>
          Open AI Control Set
        </a>
      </div>
    </div>
  );
}