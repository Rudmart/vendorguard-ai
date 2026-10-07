"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Badge } from "../../_lists/ui";
import { Can, GovernanceInfo, useCurrentUser } from "../../current-user";
import UseCaseForm, { DECISION_ROLE_HELP, STATUS_COLORS, inputStyle, labelStyle, primaryButton, readable, secondaryButton, toPayload, type UseCaseValues } from "../use-case-form";

const API = process.env.NEXT_PUBLIC_API_URL;

type Person = { id: string; displayName: string; email: string } | null;
type UseCase = {
  id: string;
  name: string;
  businessPurpose: string;
  description: string | null;
  department: string | null;
  intendedUsers: string | null;
  affectedParties: string[];
  decisionRole: string | null;
  humanOversight: string | null;
  dataSensitivity: string | null;
  status: string;
  ownerUserId: string | null;
  submittedAt: string | null;
  reviewDecision: string | null;
  reviewRationale: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aiSystem: { id: string; name: string; lifecycleStatus: string };
  owner: Person;
  createdBy: Person;
  reviewer: Person;
  missingForSubmission?: string[];
};

const card: CSSProperties = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 };
const MISSING_LABELS: Record<string, string> = { owner: "business owner", businessPurpose: "business purpose", decisionRole: "decision role", humanOversight: "human oversight" };

function when(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid #1f2a47", fontSize: 13.5 }}>
      <div style={{ width: 170, flexShrink: 0, color: "#8b96ac" }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</div>
    </div>
  );
}

function valuesOf(u: UseCase): UseCaseValues {
  return {
    name: u.name,
    businessPurpose: u.businessPurpose,
    description: u.description ?? "",
    ownerUserId: u.ownerUserId ?? "",
    department: u.department ?? "",
    intendedUsers: u.intendedUsers ?? "",
    affectedParties: u.affectedParties ?? [],
    decisionRole: u.decisionRole ?? "",
    humanOversight: u.humanOversight ?? "",
    dataSensitivity: u.dataSensitivity ?? "",
  };
}

/** Human review panel. The API enforces permission, state and separation of duties; this is only the form. */
function ReviewPanel({ useCaseId, onDone }: { useCaseId: string; onDone: () => void }) {
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/ai-use-cases/${useCaseId}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, rationale }),
      });
      const data = (await res.json().catch(() => null)) as (UseCase & { error?: string }) | null;
      if (!res.ok || !data?.id) {
        setError(data?.error ?? `Could not record the review (${res.status}).`);
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server. Check that the API is running.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={card}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>Human review</h2>
      <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0 }}>
        Your decision and rationale are recorded and audited. Approved decisions cannot be overwritten. Rejected or changes-requested use cases return to Draft.
      </p>
      <label style={labelStyle}>
        Decision *
        <select style={inputStyle} value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="">Choose a decision</option>
          <option value="APPROVED">Approve</option>
          <option value="CHANGES_REQUESTED">Request changes</option>
          <option value="REJECTED">Reject</option>
        </select>
      </label>
      <label style={labelStyle}>
        Rationale *
        <textarea style={{ ...inputStyle, minHeight: 70 }} value={rationale} maxLength={4000} onChange={(e) => setRationale(e.target.value)} />
      </label>
      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}
      <button type="button" style={primaryButton} disabled={saving || !decision || !rationale.trim()} onClick={submit}>
        {saving ? "Recording..." : "Record review decision"}
      </button>
    </div>
  );
}

export default function AiUseCaseDetailPage() {
  const params = useParams();
  const id = String(params.id);
  const { user, can } = useCurrentUser();
  const [useCase, setUseCase] = useState<UseCase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    fetch(`${API}/ai-use-cases/${id}`, { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as (UseCase & { error?: string }) | null;
        if (!res.ok || !data?.id) {
          setLoadError(res.status === 404 ? "AI use case not found." : (data?.error ?? `Could not load the use case (${res.status}).`));
          return;
        }
        setUseCase(data);
      })
      .catch(() => setLoadError("Could not reach the server. Check that the API is running."));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function save(values: UseCaseValues): Promise<string | null> {
    try {
      const res = await fetch(`${API}/ai-use-cases/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(values)),
      });
      const data = (await res.json().catch(() => null)) as (UseCase & { error?: string }) | null;
      if (!res.ok || !data?.id) {
        return data?.error ?? `Could not save (${res.status}).`;
      }
      setUseCase(data);
      setEditing(false);
      return null;
    } catch {
      return "Could not reach the server. Check that the API is running.";
    }
  }

  async function submitForReview() {
    setSubmitting(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/ai-use-cases/${id}/submit`, { method: "POST", credentials: "include" });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setActionError(data?.error ?? `Could not submit (${res.status}).`);
        return;
      }
      load();
    } catch {
      setActionError("Could not reach the server. Check that the API is running.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
        <p style={{ color: "#fca5a5" }}>{loadError}</p>
        <a href="/ai-use-cases" style={{ color: "#93c5fd" }}>
          Back to AI Use Cases
        </a>
      </main>
    );
  }
  if (!useCase) {
    return <main style={{ padding: "32px 24px", color: "#8b96ac" }}>Loading...</main>;
  }

  const u = useCase;
  const isDraft = u.status === "DRAFT";
  const missing = u.missingForSubmission ?? [];
  const involved = user !== null && (u.createdBy?.id === user.userId || u.owner?.id === user.userId);

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
      <a href="/ai-use-cases" style={{ color: "#93c5fd", fontSize: 13, textDecoration: "none" }}>
        &larr; AI Use Cases
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "10px 0 4px 0" }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{u.name}</h1>
        <Badge text={readable(u.status)} color={STATUS_COLORS[u.status] ?? "#8b96ac"} />
      </div>
      <p style={{ color: "#8b96ac", fontSize: 13, marginTop: 4 }}>
        Use of AI system{" "}
        <a href={`/ai-systems/${u.aiSystem.id}`} style={{ color: "#93c5fd" }}>
          {u.aiSystem.name}
        </a>
        . Risk and impact assessments are performed on the AI system.
      </p>

      {editing && isDraft ? (
        <UseCaseForm initial={valuesOf(u)} submitLabel="Save changes" onSubmit={save} onCancel={() => setEditing(false)} />
      ) : (
        <div style={card}>
          <Row label="Business purpose">{u.businessPurpose}</Row>
          <Row label="Description">{u.description ?? "-"}</Row>
          <Row label="Business owner">{u.owner ? `${u.owner.displayName} (${u.owner.email})` : "Not assigned"}</Row>
          <Row label="Department / team">{u.department ?? "-"}</Row>
          <Row label="Intended users">{u.intendedUsers ?? "-"}</Row>
          <Row label="Affected parties">{u.affectedParties.length ? u.affectedParties.map(readable).join(", ") : "-"}</Row>
          <Row label="Decision role">{u.decisionRole ? `${readable(u.decisionRole)} - ${DECISION_ROLE_HELP[u.decisionRole] ?? ""}` : "Not set"}</Row>
          <Row label="Human oversight">{readable(u.humanOversight)}</Row>
          <Row label="Data sensitivity">{readable(u.dataSensitivity)}</Row>
          <Row label="Created">{`${when(u.createdAt)} by ${u.createdBy?.displayName ?? "-"}`}</Row>
          <Row label="Submitted for review">{when(u.submittedAt)}</Row>
        </div>
      )}

      {u.reviewDecision && (
        <div style={card}>
          <h2 style={{ fontSize: 15, marginTop: 0 }}>{isDraft ? "Last review decision" : "Review decision"}</h2>
          <Row label="Decision">{readable(u.reviewDecision)}</Row>
          <Row label="Reviewer">{u.reviewer?.displayName ?? "-"}</Row>
          <Row label="Rationale">{u.reviewRationale ?? "-"}</Row>
          <Row label="Reviewed">{when(u.reviewedAt)}</Row>
        </div>
      )}

      {actionError && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {actionError}
        </p>
      )}

      {isDraft && !editing && (
        <Can permission="ai-system:update" fallback={<GovernanceInfo>Read-only - editing and submitting a use case requires AI system update permission.</GovernanceInfo>}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
            <button type="button" style={secondaryButton} onClick={() => setEditing(true)}>
              Edit draft
            </button>
            <button type="button" style={primaryButton} disabled={submitting || missing.length > 0} onClick={submitForReview}>
              {submitting ? "Submitting..." : "Submit for human review"}
            </button>
            {missing.length > 0 && (
              <span style={{ color: "#fbbf24", fontSize: 12.5 }}>Before submitting, add: {missing.map((m) => MISSING_LABELS[m] ?? m).join(", ")}.</span>
            )}
          </div>
        </Can>
      )}

      {u.status === "PENDING_REVIEW" &&
        (can("ai-use-case:review") ? (
          involved ? (
            <GovernanceInfo>Separation of duties: the creator and the business owner cannot review this use case. Another ADMIN or REVIEWER must decide.</GovernanceInfo>
          ) : (
            <ReviewPanel useCaseId={u.id} onDone={load} />
          )
        ) : (
          <GovernanceInfo>Pending human review. Approval is a human decision made by an ADMIN or REVIEWER.</GovernanceInfo>
        ))}

      {u.status === "APPROVED" && <GovernanceInfo>Approved by a human reviewer. Approved use cases are read-only in this version.</GovernanceInfo>}
    </main>
  );
}
