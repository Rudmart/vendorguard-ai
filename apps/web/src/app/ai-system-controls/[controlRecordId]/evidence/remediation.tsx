"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { GovernanceInfo, useCurrentUser } from "../../../current-user";

const API = process.env.NEXT_PUBLIC_API_URL;

type UserRef = { id: string; displayName: string; email: string };
type Verification = { id: string; decision: string; rationale: string; previousStatus: string; newStatus: string; createdAt: string; verifier: UserRef };
type Remediation = {
  id: string;
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  closedAt: string | null;
  owner: UserRef | null;
  overdue: boolean;
  verifications: Verification[];
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  PENDING_VERIFICATION: "Pending Verification",
  CLOSED: "Closed (verified)",
  OVERDUE: "Overdue",
};
const STATUS_COLOR: Record<string, string> = { OPEN: "#3b82f6", IN_PROGRESS: "#eab308", PENDING_VERIFICATION: "#a855f7", CLOSED: "#22c55e", OVERDUE: "#ef4444" };

const box: CSSProperties = { background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8, padding: 12, marginTop: 10 };
const field: CSSProperties = {
  background: "#0b1220",
  color: "#e5e7eb",
  border: "1px solid #374151",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  marginBottom: 8,
  colorScheme: "dark",
};
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not set";
}

async function send(method: "POST" | "PATCH", url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Request failed (" + res.status + ")";
}

export default function FindingRemediation({ findingId, findingStatus, onChanged }: { findingId: string; findingStatus: string; onChanged: () => void }) {
  const [rem, setRem] = useState<Remediation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { can } = useCurrentUser();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/governance-findings/${findingId}/remediation`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        const json = (await res.json()) as { remediation: Remediation | null };
        if (!cancelled) {
          setRem(json.remediation);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load remediation");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [findingId, reloadKey]);

  async function run(action: () => Promise<string | null>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const err = await action();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setMessage(success);
    setRationale("");
    setReloadKey((k) => k + 1);
    onChanged();
  }

  if (!loaded && !error) {
    return null;
  }

  return (
    <div style={box}>
      <div style={{ color: "#93c5fd", fontSize: 13, fontWeight: 600 }}>Remediation</div>
      <p style={muted}>
        Remediation is the corrective work. The owner saying the work is done is not the same as verified. Only an independent verifier can close the
        remediation and the Finding. Risk acceptance is a separate decision.
      </p>
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}
      {message && <p style={{ ...muted, color: "#86efac" }}>{message}</p>}

      {!rem && findingStatus === "OPEN" && can("remediation:create") && (
        <div>
          <span style={label}>Corrective action title</span>
          <input style={field} placeholder="e.g. Require an approval record before final decision" value={title} onChange={(e) => setTitle(e.target.value)} />
          <span style={label}>Corrective action description</span>
          <textarea
            style={field}
            rows={2}
            placeholder="e.g. Update the approval workflow so a decision cannot be finalized without a recorded human approval."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <span style={label}>Owner email (accountable person - cannot verify their own work)</span>
          <input style={field} placeholder="e.g. ruddy@vendorguard.com" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          <span style={label}>Due date</span>
          <input style={field} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <button
            style={button}
            disabled={busy || !title || !description || !ownerEmail}
            onClick={() =>
              void run(
                () => send("POST", `${API}/governance-findings/${findingId}/remediation`, { title, description, ownerEmail, dueDate: dueDate || undefined }),
                "Remediation created.",
              )
            }
          >
            Create remediation
          </button>
          <span style={muted}>ADMIN or ANALYST.</span>
        </div>
      )}

      {rem && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{rem.title}</strong>
            <span
              style={{
                border: "1px solid " + (STATUS_COLOR[rem.status] ?? "#94a3b8"),
                color: STATUS_COLOR[rem.status] ?? "#94a3b8",
                borderRadius: 999,
                padding: "2px 10px",
                fontSize: 12,
              }}
            >
              {STATUS_LABEL[rem.status] ?? rem.status}
            </span>
          </div>
          <p style={muted}>{rem.description}</p>
          <p style={muted}>
            Owner: {rem.owner ? rem.owner.displayName + " (" + rem.owner.email + ")" : "Not assigned"} | Due: {formatDate(rem.dueDate)}
            {rem.overdue ? " (overdue)" : ""}
          </p>

          {rem.status === "OPEN" && (can("remediation:update") || can("remediation:create")) && (
            <button style={button} disabled={busy} onClick={() => void run(() => send("PATCH", `${API}/governance-remediations/${rem.id}`, { status: "IN_PROGRESS" }), "Work started.")}>
              Start work (In Progress)
            </button>
          )}
          {rem.status === "IN_PROGRESS" && (
            <>
              <button style={button} disabled={busy} onClick={() => void run(() => send("POST", `${API}/governance-remediations/${rem.id}/submit`, {}), "Submitted for independent verification.")}>
                Submit for verification
              </button>
              <span style={muted}>Owner only. This says the work is done - it does not verify it.</span>
            </>
          )}
          {rem.status === "PENDING_VERIFICATION" && !can("remediation:verify") && <GovernanceInfo>Independent verification required - verifier permission required.</GovernanceInfo>}
          {rem.status === "PENDING_VERIFICATION" && can("remediation:verify") && (
            <div>
              <span style={label}>Verification rationale (required)</span>
              <textarea
                style={field}
                rows={2}
                placeholder="e.g. Re-sampled 10 decisions after the change; all had approval records."
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
              <button
                style={{ ...button, background: "#15803d" }}
                disabled={busy}
                onClick={() => void run(() => send("POST", `${API}/governance-remediations/${rem.id}/verify`, { decision: "VERIFIED", rationale }), "Verified. Remediation and Finding are now closed.")}
              >
                Verify (close)
              </button>
              <button
                style={{ ...button, background: "#b91c1c" }}
                disabled={busy}
                onClick={() => void run(() => send("POST", `${API}/governance-remediations/${rem.id}/verify`, { decision: "REJECTED", rationale }), "Rejected. Remediation is back In Progress.")}
              >
                Reject
              </button>
              <span style={muted}>Verifiers: ADMIN, REVIEWER or AUDITOR. The owner cannot verify their own remediation.</span>
            </div>
          )}
          {rem.status === "CLOSED" && <p style={{ ...muted, color: "#86efac" }}>Independently verified on {formatDate(rem.closedAt)}. The Finding is closed.</p>}

          {rem.verifications.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ ...muted, fontWeight: 600 }}>Verification history</div>
              {rem.verifications.map((v) => (
                <p key={v.id} style={{ ...muted, margin: "4px 0" }}>
                  {new Date(v.createdAt).toLocaleString()} - {v.verifier.displayName} ({v.verifier.email}): {v.decision} ({STATUS_LABEL[v.previousStatus] ?? v.previousStatus}
                  {" -> "}
                  {STATUS_LABEL[v.newStatus] ?? v.newStatus}) - {v.rationale}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}