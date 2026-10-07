"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import TenantUserSelect from "../tenant-user-select";

// AI Use Cases V1 - shared values (mirror the API / Prisma enums; the API re-validates everything).
export const DECISION_ROLES = ["ADVISORY", "RECOMMENDS", "DECIDES", "EXECUTES"] as const;
export const DECISION_ROLE_HELP: Record<string, string> = {
  ADVISORY: "Provides information only.",
  RECOMMENDS: "Produces recommendations that humans evaluate.",
  DECIDES: "Makes decisions.",
  EXECUTES: "Can perform actions or transactions.",
};
export const HUMAN_OVERSIGHT = ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"] as const;
export const DATA_SENSITIVITY = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export const AFFECTED_PARTIES = ["EMPLOYEES", "CUSTOMERS", "PUBLIC", "OTHER"] as const;
export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#8b96ac",
  PENDING_REVIEW: "#fbbf24",
  APPROVED: "#4ade80",
  SUSPENDED: "#fb923c",
  RETIRED: "#64748b",
};

export function readable(value: string | null | undefined): string {
  return value ? value.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Not set";
}

export type UseCaseValues = {
  name: string;
  businessPurpose: string;
  description: string;
  ownerUserId: string;
  department: string;
  intendedUsers: string;
  affectedParties: string[];
  decisionRole: string;
  humanOversight: string;
  dataSensitivity: string;
};

export const EMPTY_VALUES: UseCaseValues = {
  name: "",
  businessPurpose: "",
  description: "",
  ownerUserId: "",
  department: "",
  intendedUsers: "",
  affectedParties: [],
  decisionRole: "",
  humanOversight: "",
  dataSensitivity: "",
};

/** Request body for create / PATCH. Empty optional values are sent as null (= not set). */
export function toPayload(v: UseCaseValues): Record<string, unknown> {
  return {
    name: v.name,
    businessPurpose: v.businessPurpose,
    description: v.description || null,
    ownerUserId: v.ownerUserId || null,
    department: v.department || null,
    intendedUsers: v.intendedUsers || null,
    affectedParties: v.affectedParties,
    decisionRole: v.decisionRole || null,
    humanOversight: v.humanOversight || null,
    dataSensitivity: v.dataSensitivity || null,
  };
}

export const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid #233150",
  background: "#0a0f1a",
  color: "#e9edf6",
  fontSize: 14,
  marginTop: 4,
  boxSizing: "border-box",
  colorScheme: "dark",
};
export const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "#8b96ac", marginBottom: 14 };
export const primaryButton: CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 13.5,
  fontWeight: 700,
  cursor: "pointer",
};
export const secondaryButton: CSSProperties = { ...primaryButton, background: "transparent", border: "1px solid #2e3d63", color: "#cbd5e1" };

/**
 * One form for "register" and "edit" (DRAFT only). Submission requirements (owner, purpose, decision role,
 * human oversight) are only enforced when the use case is submitted for review - a draft can be saved incomplete.
 */
export default function UseCaseForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  header,
}: {
  initial: UseCaseValues;
  submitLabel: string;
  onSubmit: (values: UseCaseValues) => Promise<string | null>;
  onCancel?: () => void;
  header?: React.ReactNode;
}) {
  const [v, setV] = useState<UseCaseValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof UseCaseValues>(key: K, value: UseCaseValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  async function handle(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      setError(await onSubmit(v));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handle} style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 }}>
      {header}
      <label style={labelStyle}>
        Use case name *
        <input style={inputStyle} value={v.name} maxLength={200} required onChange={(e) => set("name", e.target.value)} placeholder="e.g. Consumer loan decision support" />
      </label>
      <label style={labelStyle}>
        Business purpose * <span style={{ fontSize: 11.5 }}>(why the AI is used and the outcome expected)</span>
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={v.businessPurpose} maxLength={4000} required onChange={(e) => set("businessPurpose", e.target.value)} />
      </label>
      <label style={labelStyle}>
        Description <span style={{ fontSize: 11.5 }}>(how the AI is used in practice)</span>
        <textarea style={{ ...inputStyle, minHeight: 60 }} value={v.description} maxLength={4000} onChange={(e) => set("description", e.target.value)} />
      </label>
      <label style={labelStyle}>
        Business owner <span style={{ fontSize: 11.5 }}>(accountable person - required before review)</span>
        <TenantUserSelect value={v.ownerUserId} onChange={(id) => set("ownerUserId", id)} emptyLabel="No owner yet" style={inputStyle} />
      </label>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ ...labelStyle, flex: "1 1 220px" }}>
          Department / team
          <input style={inputStyle} value={v.department} maxLength={200} onChange={(e) => set("department", e.target.value)} />
        </label>
        <label style={{ ...labelStyle, flex: "1 1 220px" }}>
          Intended users <span style={{ fontSize: 11.5 }}>(who operates it)</span>
          <input style={inputStyle} value={v.intendedUsers} maxLength={1000} onChange={(e) => set("intendedUsers", e.target.value)} />
        </label>
      </div>
      <div style={labelStyle}>
        Affected parties
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 6 }}>
          {AFFECTED_PARTIES.map((p) => (
            <label key={p} style={{ color: "#e6e9f0", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={v.affectedParties.includes(p)}
                onChange={() => set("affectedParties", v.affectedParties.includes(p) ? v.affectedParties.filter((x) => x !== p) : [...v.affectedParties, p])}
              />{" "}
              {readable(p)}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ ...labelStyle, flex: "1 1 200px" }}>
          Decision role
          <select style={inputStyle} value={v.decisionRole} onChange={(e) => set("decisionRole", e.target.value)}>
            <option value="">Not set</option>
            {DECISION_ROLES.map((o) => (
              <option key={o} value={o}>
                {readable(o)}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11.5 }}>{v.decisionRole ? DECISION_ROLE_HELP[v.decisionRole] : "How much authority the AI has in this use."}</span>
        </label>
        <label style={{ ...labelStyle, flex: "1 1 200px" }}>
          Human oversight
          <select style={inputStyle} value={v.humanOversight} onChange={(e) => set("humanOversight", e.target.value)}>
            <option value="">Not set</option>
            {HUMAN_OVERSIGHT.map((o) => (
              <option key={o} value={o}>
                {readable(o)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: "1 1 200px" }}>
          Data sensitivity
          <select style={inputStyle} value={v.dataSensitivity} onChange={(e) => set("dataSensitivity", e.target.value)}>
            <option value="">Not set</option>
            {DATA_SENSITIVITY.map((o) => (
              <option key={o} value={o}>
                {readable(o)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="submit" disabled={saving} style={primaryButton}>
          {saving ? "Saving..." : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} style={secondaryButton}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
