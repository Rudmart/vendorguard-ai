"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "../../current-user";
type Assessment = { id: string; createdAt: string; status: string; residualScore: number | null; riskBand: string | null; aiResidualScore: number | null; aiRiskBand: string | null; questionnaires: { id: string; status: string }[]; findings: { id: string; status: string; requiresHumanReview: boolean }[] };
type Cycle = { id: string; priorAssessmentId: string; newAssessmentId: string; trigger: string; rationale: string; materialChanges: string; targetDate: string | null; status: string; startedByUserId: string; completedByUserId: string | null; completedAt: string | null; conclusion: string | null };
type Acceptance = { id: string; assessmentId: string | null; vendorFindingId: string | null; status: string; justification: string; residualRiskStatement: string | null; conditions: string | null; expiresAt: string | null; createdAt: string; requestedByUserId: string | null; approvedByUserId: string | null; decidedByUserId: string | null; decidedAt: string | null; decisionRationale: string | null; vendorRiskContextHash: string | null; vendorRiskSnapshot: { residualScore?: number | null; riskBand?: string | null } | null };
type Monitoring = { contractReviewDate: string | null; reviewDue: boolean; expiredAcceptances: string[]; assessments: Assessment[]; reassessments: Cycle[]; triggers: string[] };
export default function VendorGovernance({ vendorId }: { vendorId: string }) {
  const { user, can } = useCurrentUser();
  const [data, setData] = useState<Monitoring | null>(null), [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [prior, setPrior] = useState(""), [trigger, setTrigger] = useState("SCHEDULED_REVIEW"), [reason, setReason] = useState(""), [changes, setChanges] = useState(""), [target, setTarget] = useState("");
  const [assessmentId, setAssessment] = useState(""), [findingId, setFinding] = useState(""), [justification, setJustification] = useState(""), [residual, setResidual] = useState(""), [conditions, setConditions] = useState(""), [expiry, setExpiry] = useState("");
  const [rationales, setRationales] = useState<Record<string, string>>({}), [edits, setEdits] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const [monitoring, risks] = await Promise.all([fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/monitoring`, { credentials: "include" }), fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/risk-acceptance`, { credentials: "include" })]);
    if (!monitoring.ok || !risks.ok) throw new Error("Vendor governance records could not be loaded");
    setData(await monitoring.json()); setAcceptances((await risks.json()).riskAcceptances);
  }, [vendorId]);
  useEffect(() => { load().catch(() => setError("Vendor governance records could not be loaded")); }, [load]);
  async function act(path: string, payload: object, method = "POST") {
    setBusy(true); setError("");
    try { const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await r.json(); if (!r.ok) throw new Error(result.error ?? "Action failed"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
  }
  const selected = data?.assessments.find(a => a.id === assessmentId);
  if (!data) return <section><h2>Vendor monitoring and risk acceptance</h2><p>{error || "Loading governance records..."}</p></section>;
  return <section style={{ marginTop: 24 }}>
    {error && <p role="alert">{error}</p>}
    <h2>Vendor monitoring / reassessment</h2>
    <p>Human-triggered review of changes and recorded review dates. This does not provide live model or security monitoring.</p>
    <p>Contract review: {data.contractReviewDate ? new Date(data.contractReviewDate).toLocaleDateString() : "Not recorded"}{data.reviewDue ? " — review due" : ""}. Expired recorded acceptances: {data.expiredAcceptances.length}.</p>
    {can("assessment:create") && <form onSubmit={e => { e.preventDefault(); void act(`/vendors/${vendorId}/reassessments`, { priorAssessmentId: prior, trigger, rationale: reason, materialChanges: changes, ...(target ? { targetDate: new Date(`${target}T00:00:00`).toISOString() } : {}) }); }}>
      <p><label>Previous assessment <select required value={prior} onChange={e => setPrior(e.target.value)}><option value="">Select previous assessment</option>{data.assessments.map(a => <option key={a.id} value={a.id}>{new Date(a.createdAt).toLocaleDateString()} — {a.status} — {a.id}</option>)}</select></label></p>
      <p><label>Trigger <select value={trigger} onChange={e => setTrigger(e.target.value)}>{data.triggers.map(t => <option key={t}>{t}</option>)}</select></label></p>
      <p><label>Why reassessment is needed <textarea required maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label></p>
      <p><label>Material changes (or explicitly state none identified) <textarea required maxLength={4000} value={changes} onChange={e => setChanges(e.target.value)} /></label></p>
      <p><label>Target review date <input type="date" value={target} onChange={e => setTarget(e.target.value)} /></label></p>
      <button disabled={busy || !prior || data.reassessments.some(c => c.status === "IN_PROGRESS")}>Start vendor reassessment</button>
    </form>}
    {data.reassessments.length === 0 && <p>No vendor reassessment recorded.</p>}
    {data.reassessments.map(c => <article key={c.id} style={{ margin: "16px 0", padding: 12, border: "1px solid #233150" }}>
      <h3>{c.trigger} — {c.status}</h3><p>{c.rationale}</p><p>Material changes: {c.materialChanges}</p>
      <p><Link href={`/assessments/${c.priorAssessmentId}`}>Previous assessment</Link> → <Link href={`/assessments/${c.newAssessmentId}`}>Updated assessment / questionnaire</Link></p>
      <p>Initiator: {c.startedByUserId}. Target: {c.targetDate ? new Date(c.targetDate).toLocaleDateString() : "Not recorded"}.</p>
      {c.status === "IN_PROGRESS" && can("assessment:create") && (c.startedByUserId === user?.userId || user?.role === "ADMIN") && <><label>Updated material-change record <textarea maxLength={4000} value={edits[c.id] ?? c.materialChanges} onChange={e => setEdits({ ...edits, [c.id]: e.target.value })} /></label><button disabled={busy || !(edits[c.id] ?? c.materialChanges).trim()} onClick={() => void act(`/vendor-reassessments/${c.id}`, { materialChanges: edits[c.id] ?? c.materialChanges, targetDate: c.targetDate }, "PATCH")}>Save change record</button></>}
      {c.status === "IN_PROGRESS" && can("risk:accept") && c.startedByUserId !== user?.userId && <><p>Complete only after the updated assessment questionnaires have independent review/approval and findings have human decisions. Completion does not approve the vendor or close its risks.</p><label>Completion rationale <textarea maxLength={4000} value={rationales[c.id] ?? ""} onChange={e => setRationales({ ...rationales, [c.id]: e.target.value })} /></label><button disabled={busy || !rationales[c.id]?.trim()} onClick={() => void act(`/vendor-reassessments/${c.id}/complete`, { rationale: rationales[c.id] })}>Record independent completion</button></>}
      {c.completedAt && <p>Completed {new Date(c.completedAt).toLocaleString()} by {c.completedByUserId}: {c.conclusion}</p>}
    </article>)}
    <h2>Vendor risk acceptance</h2>
    <p>AI ASSISTS. HUMANS GOVERN. Acceptance tolerates recorded residual risk for a period; it does not remediate risk, prove control effectiveness, approve a vendor or declare compliance.</p>
    {(can("assessment:create") || can("risk:accept")) && <form onSubmit={e => { e.preventDefault(); void act(`/vendors/${vendorId}/risk-acceptance`, { assessmentId, ...(findingId ? { findingId } : {}), justification, residualRiskStatement: residual, ...(conditions.trim() ? { conditions } : {}), expiresAt: new Date(`${expiry}T23:59:59`).toISOString() }); }}>
      <p><label>Risk assessment context <select required value={assessmentId} onChange={e => { setAssessment(e.target.value); setFinding(""); }}><option value="">Select assessment</option>{data.assessments.map(a => <option key={a.id} value={a.id}>{new Date(a.createdAt).toLocaleDateString()} — {a.id}</option>)}</select></label></p>
      {selected && <p>Recorded residual score: {selected.residualScore ?? "Not assessed"}; risk band: {selected.riskBand ?? "Not assessed"}. AI residual score: {selected.aiResidualScore ?? "Not assessed"}; AI risk band: {selected.aiRiskBand ?? "Not assessed"}.</p>}
      <p><label>Specific reviewed finding (where applicable) <select value={findingId} onChange={e => setFinding(e.target.value)}><option value="">Assessment-level residual risk</option>{selected?.findings.filter(f => !f.requiresHumanReview).map(f => <option key={f.id} value={f.id}>{f.status} — {f.id}</option>)}</select></label></p>
      <p><label>Acceptance rationale <textarea required maxLength={4000} value={justification} onChange={e => setJustification(e.target.value)} /></label></p>
      <p><label>Residual risk being accepted <textarea required maxLength={4000} value={residual} onChange={e => setResidual(e.target.value)} /></label></p>
      <p><label>Conditions <textarea maxLength={4000} value={conditions} onChange={e => setConditions(e.target.value)} /></label></p>
      <p><label>Expiration / review date <input required type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label></p>
      <button disabled={busy || !assessmentId || !expiry}>Request independent acceptance decision</button><p>An authorized ADMIN/REVIEWER other than the requester must decide.</p>
    </form>}
    {acceptances.length === 0 && <p>No vendor risk acceptance recorded.</p>}
    {acceptances.map(a => <article key={a.id} style={{ margin: "16px 0", padding: 12, border: "1px solid #233150" }}>
      <h3>{a.status}{a.status === "APPROVED" && a.expiresAt && new Date(a.expiresAt).getTime() <= Date.now() ? " — EXPIRED" : ""}</h3>
      <p>{a.justification}</p><p>Residual risk: {a.residualRiskStatement ?? "Not recorded"}</p><p>Conditions: {a.conditions ?? "Not recorded"}</p>
      <p>Requested {new Date(a.createdAt).toLocaleString()} by {a.requestedByUserId ?? "Not recorded"}. Expires: {a.expiresAt ? new Date(a.expiresAt).toLocaleDateString() : "Not recorded"}.</p>
      {a.vendorRiskSnapshot && <p>Request-time residual score: {a.vendorRiskSnapshot.residualScore ?? "Not assessed"}; band: {a.vendorRiskSnapshot.riskBand ?? "Not assessed"}.</p>}
      {a.assessmentId && <p><Link href={`/assessments/${a.assessmentId}`}>Source assessment</Link>{a.vendorFindingId ? `; finding ${a.vendorFindingId}` : ""}</p>}
      {!a.vendorRiskContextHash && <p>Historical record: only stored attribution is shown; no retroactive approval or requester is inferred.</p>}
      {a.decidedAt && <p>Decision by {a.decidedByUserId}, {new Date(a.decidedAt).toLocaleString()}: {a.decisionRationale}</p>}
      {!a.decidedAt && a.approvedByUserId && <p>Stored historical approver: {a.approvedByUserId}</p>}
      {a.status === "PENDING_REVIEW" && a.vendorRiskContextHash && can("risk:accept") && a.requestedByUserId !== user?.userId && <><label>Independent decision rationale <textarea maxLength={4000} value={rationales[a.id] ?? ""} onChange={e => setRationales({ ...rationales, [a.id]: e.target.value })} /></label>{["APPROVED", "REJECTED"].map(decision => <button key={decision} disabled={busy || !rationales[a.id]?.trim()} onClick={() => void act(`/vendor-risk-acceptances/${a.id}/decision`, { decision, rationale: rationales[a.id] })}>{decision === "APPROVED" ? "Approve acceptance" : "Reject acceptance"}</button>)}</>}
    </article>)}
  </section>;
}
