"use client";
import { useEffect, useState } from "react";
import { useCurrentUser } from "./current-user";
type Approval = { id: string; status: string; requestedByUserId: string; independentOfUserIds: string[]; requestedAt: string; decidedAt: string | null; decidedByUserId: string | null; requestRationale: string; decisionRationale: string | null };
export default function SystemApproval({ id, retired }: { id: string; retired: boolean }) {
  const { user, can } = useCurrentUser();
  const [data, setData] = useState<{ blockers: string[]; history: Approval[] } | null>(null), [error, setError] = useState(""), [rationale, setRationale] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/approval`, { credentials: "include" }).then(async r => { const value = await r.json(); if (!active) return; if (r.ok) setData(value); else setError(value.error ?? "Could not load system approval"); }).catch(() => { if (active) setError("Could not reach the API"); }); return () => { active = false; }; }, [id]);
  async function act(path: string, decision?: string) {
    setError(""); setBusy(true);
    try { const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rationale, decision }) }); const value = await r.json(); if (!r.ok) { setError(value.error ?? "System approval failed"); return; } window.location.reload(); }
    catch { setError("Could not reach the API"); } finally { setBusy(false); }
  }
  const pending = data?.history.find(a => a.status === "PENDING_REVIEW");
  const independent = pending && user && pending.requestedByUserId !== user.userId && !pending.independentOfUserIds.includes(user.userId);
  return <section id="system-approval" style={{ marginBottom: 24 }}><h2>System governance approval</h2>
    <p>AI ASSISTS. HUMANS GOVERN. System approval is a separate independent decision; an inventory status or assessment approval alone does not authorize production.</p>
    {!data && !error && <p>Loading approval readiness…</p>}
    {data && data.blockers.length > 0 && <ul>{data.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
    {!retired && data && <>
      <label>Decision or request rationale<textarea value={rationale} maxLength={4000} onChange={e => setRationale(e.target.value)} style={{ display: "block", width: "100%" }} /></label>
      {!pending && can("ai-system:update") && <button disabled={busy || !rationale.trim() || data.blockers.length > 0} onClick={() => void act(`/ai-systems/${id}/approval-request`)}>Request independent system approval</button>}
      {pending && independent && can("ai-system:approve") && <><button disabled={busy || !rationale.trim() || data.blockers.length > 0} onClick={() => void act(`/ai-system-approvals/${pending.id}/decision`, "APPROVED")}>Approve system</button><button disabled={busy || !rationale.trim()} onClick={() => void act(`/ai-system-approvals/${pending.id}/decision`, "REJECTED")}>Reject system approval</button></>}
      {pending && pending.requestedByUserId === user?.userId && can("ai-system:update") && <button disabled={busy || !rationale.trim()} onClick={() => void act(`/ai-system-approvals/${pending.id}/cancel`)}>Cancel pending request</button>}
    </>}
    {error && <p role="alert">{error}</p>}
    {data?.history.map(a => <div key={a.id}><strong>{a.status}</strong> — requested {a.requestedAt}<p>{a.requestRationale}</p>{a.decidedAt && <p>Decision recorded {a.decidedAt} by {a.decidedByUserId}: {a.decisionRationale}</p>}</div>)}
    {data?.history.length === 0 && <p>No system approval has been recorded. Historical lifecycle labels are not retroactive approvals.</p>}
  </section>;
}
