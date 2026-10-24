"use client";
import { useState } from "react";
import { useCurrentUser } from "./current-user";

export default function AssessmentSubmission({ kind, id, status, count, justification, assessorUserId, refresh }: { kind: "risk" | "impact"; id: string; status: string; count: number; justification?: string | null; assessorUserId?: string | null; refresh: () => void }) {
  const { can, user } = useCurrentUser();
  const [text, setText] = useState(justification ?? ""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-${kind}-assessments/${id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "READY_FOR_REVIEW", ...(count === 0 ? { noItemsJustification: text } : {}) }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "Could not submit assessment"); return; }
      refresh();
    } catch { setError("Could not reach the API"); } finally { setBusy(false); }
  }
  return <section style={{ margin: "16px 0" }}>
    {justification && <p>No items identified — assessor justification: {justification}</p>}
    {status !== "COMPLETED" && status !== "READY_FOR_REVIEW" && can("ai-system:update") && <>
      {count === 0 && <label>No items identified — assessor justification<textarea value={text} maxLength={4000} onChange={e => setText(e.target.value)} disabled={user?.userId !== assessorUserId} style={{ display: "block", width: "100%" }} /></label>}
      <button type="button" disabled={busy || (count === 0 && (!text.trim() || user?.userId !== assessorUserId))} onClick={() => void submit()}>{busy ? "Submitting…" : "Submit for independent review"}</button>
    </>}
    {status === "READY_FOR_REVIEW" && <p>Submitted for independent human review.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
