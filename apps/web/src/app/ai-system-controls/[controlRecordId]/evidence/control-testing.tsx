"use client";

import { useEffect, useState, type CSSProperties } from "react";

const API = process.env.NEXT_PUBLIC_API_URL;

type Effectiveness = "NOT_ASSESSED" | "INEFFECTIVE" | "PARTIALLY_EFFECTIVE" | "EFFECTIVE";
type UserRef = { id: string; displayName: string; email: string };
type TestEvidence = {
  id: string;
  evidenceLink: { id: string; status: string; evidenceDocument: { id: string; displayFilename: string; documentType: string } };
};
type ControlTest = {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  method: string;
  procedure: string;
  testDate: string | null;
  sampleSize: number | null;
  exceptionsFound: number | null;
  designEffectiveness: Effectiveness;
  operatingEffectiveness: Effectiveness;
  overallEffectiveness: Effectiveness;
  conclusionRationale: string | null;
  nextTestDate: string | null;
  completedAt: string | null;
  createdAt: string;
  tester: UserRef;
  evidence: TestEvidence[];
};
export type EvidenceLinkOption = { id: string; status: string; evidenceDocument: { displayFilename: string; documentType: string } };
type Draft = {
  method: string;
  procedure: string;
  testDate: string;
  sampleSize: string;
  exceptionsFound: string;
  designEffectiveness: Effectiveness;
  operatingEffectiveness: Effectiveness;
  overallEffectiveness: Effectiveness;
  conclusionRationale: string;
  nextTestDate: string;
};

const METHODS: { value: string; label: string }[] = [
  { value: "DOCUMENT_REVIEW", label: "Document review" },
  { value: "INTERVIEW", label: "Interview" },
  { value: "OBSERVATION", label: "Observation" },
  { value: "SAMPLE_TESTING", label: "Sample testing" },
  { value: "CONFIGURATION_REVIEW", label: "Configuration review" },
  { value: "OTHER", label: "Other" },
];
const NOT_TESTED: { value: Effectiveness; label: string; color: string } = { value: "NOT_ASSESSED", label: "Not Tested", color: "#94a3b8" };
const EFFECTIVENESS: { value: Effectiveness; label: string; color: string }[] = [
  NOT_TESTED,
  { value: "INEFFECTIVE", label: "Ineffective", color: "#f87171" },
  { value: "PARTIALLY_EFFECTIVE", label: "Partially Effective", color: "#fbbf24" },
  { value: "EFFECTIVE", label: "Effective", color: "#4ade80" },
];
const EVIDENCE_LABEL: Record<string, string> = {
  NO_EVIDENCE: "No Evidence",
  PENDING_REVIEW: "Pending Review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};
const EMPTY_DRAFT: Draft = {
  method: "DOCUMENT_REVIEW",
  procedure: "",
  testDate: "",
  sampleSize: "",
  exceptionsFound: "",
  designEffectiveness: "NOT_ASSESSED",
  operatingEffectiveness: "NOT_ASSESSED",
  overallEffectiveness: "NOT_ASSESSED",
  conclusionRationale: "",
  nextTestDate: "",
};

const card: CSSProperties = { background: "#111827", border: "1px solid #1f2937", borderRadius: 8, padding: 16, marginBottom: 16 };
const inner: CSSProperties = { background: "#0b1220", border: "1px solid #1f2937", borderRadius: 8, padding: 12, marginBottom: 12 };
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
};
const button: CSSProperties = { background: "#2563eb", color: "white", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 13, cursor: "pointer", marginRight: 8 };
const muted: CSSProperties = { color: "#9ca3af", fontSize: 12 };
const label: CSSProperties = { color: "#cbd5e1", fontSize: 12, display: "block", marginBottom: 4 };
const heading: CSSProperties = { color: "#e5e7eb", fontSize: 15, margin: "0 0 10px 0" };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 };

function effInfo(value: string) {
  return EFFECTIVENESS.find((item) => item.value === value) ?? NOT_TESTED;
}

function methodLabel(value: string) {
  return METHODS.find((item) => item.value === value)?.label ?? value;
}

function EffBadge({ value }: { value: string }) {
  const info = effInfo(value);
  return (
    <span style={{ border: "1px solid " + info.color, color: info.color, borderRadius: 999, padding: "2px 10px", fontSize: 12, whiteSpace: "nowrap" }}>
      {info.label}
    </span>
  );
}

function toDateInput(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" }) : "Not set";
}

function draftFrom(test: ControlTest): Draft {
  return {
    method: test.method,
    procedure: test.procedure,
    testDate: toDateInput(test.testDate),
    sampleSize: test.sampleSize === null ? "" : String(test.sampleSize),
    exceptionsFound: test.exceptionsFound === null ? "" : String(test.exceptionsFound),
    designEffectiveness: test.designEffectiveness,
    operatingEffectiveness: test.operatingEffectiveness,
    overallEffectiveness: test.overallEffectiveness,
    conclusionRationale: test.conclusionRationale ?? "",
    nextTestDate: toDateInput(test.nextTestDate),
  };
}

function draftPayload(draft: Draft) {
  return {
    method: draft.method,
    procedure: draft.procedure,
    testDate: draft.testDate || null,
    sampleSize: draft.sampleSize === "" ? null : Number(draft.sampleSize),
    exceptionsFound: draft.exceptionsFound === "" ? null : Number(draft.exceptionsFound),
    designEffectiveness: draft.designEffectiveness,
    operatingEffectiveness: draft.operatingEffectiveness,
    overallEffectiveness: draft.overallEffectiveness,
    conclusionRationale: draft.conclusionRationale || null,
    nextTestDate: draft.nextTestDate || null,
  };
}

async function send(method: "POST" | "PATCH", url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? "Request failed (" + res.status + ")";
}

export default function ControlTestingSection({
  controlRecordId,
  evidenceLinks,
  assuranceStatus,
  disabled,
}: {
  controlRecordId: string;
  evidenceLinks: EvidenceLinkOption[];
  assuranceStatus: string;
  disabled: boolean;
}) {
  const [tests, setTests] = useState<ControlTest[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [selectedLink, setSelectedLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/ai-system-controls/${controlRecordId}/tests`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(String(res.status));
        }
        const json = (await res.json()) as { tests: ControlTest[] };
        if (cancelled) {
          return;
        }
        setTests(json.tests);
        const open = json.tests.find((test) => test.status === "IN_PROGRESS");
        setDraft(open ? draftFrom(open) : EMPTY_DRAFT);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load control tests");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [controlRecordId, reloadKey]);

  function update(key: keyof Draft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }) as Draft);
  }

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
    setSelectedLink("");
    setReloadKey((k) => k + 1);
  }

  const inProgress = tests.find((test) => test.status === "IN_PROGRESS") ?? null;
  const completed = tests.filter((test) => test.status === "COMPLETED");
  const latest = completed[0] ?? null;
  const usedLinkIds = new Set((inProgress?.evidence ?? []).map((item) => item.evidenceLink.id));
  const addable = evidenceLinks.filter((link) => !usedLinkIds.has(link.id));

  const effSelect = (key: "designEffectiveness" | "operatingEffectiveness" | "overallEffectiveness", text: string) => (
    <div>
      <span style={label}>{text}</span>
      <select style={field} value={draft[key]} onChange={(e) => update(key, e.target.value)}>
        {EFFECTIVENESS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section style={card}>
      <h2 style={heading}>Control testing</h2>
      <p style={muted}>
        Evidence review asks whether the evidence is acceptable. Control testing asks whether the control actually works. Accepted evidence does not mean the
        control is effective - they are separate human decisions.
      </p>

      <div style={{ ...inner, display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <span style={label}>Evidence assurance (evidence review)</span>
          <strong style={{ fontSize: 13 }}>{EVIDENCE_LABEL[assuranceStatus] ?? assuranceStatus}</strong>
        </div>
        <div>
          <span style={label}>Control effectiveness (latest completed test)</span>
          <EffBadge value={latest ? latest.overallEffectiveness : "NOT_ASSESSED"} />
        </div>
      </div>

      {error && <div style={{ ...inner, borderColor: "#7f1d1d", color: "#fca5a5" }}>{error}</div>}
      {message && <div style={{ ...inner, borderColor: "#14532d", color: "#86efac" }}>{message}</div>}

      {latest && (
        <div style={inner}>
          <div style={{ ...muted, fontWeight: 600, marginBottom: 6 }}>Latest completed test</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
            <span style={muted}>
              Design: <EffBadge value={latest.designEffectiveness} />
            </span>
            <span style={muted}>
              Operating: <EffBadge value={latest.operatingEffectiveness} />
            </span>
            <span style={muted}>
              Overall: <EffBadge value={latest.overallEffectiveness} />
            </span>
          </div>
          <p style={muted}>
            Tested by {latest.tester.displayName} ({latest.tester.email}) on {formatDate(latest.testDate)} | Method: {methodLabel(latest.method)}
            {latest.sampleSize !== null ? " | Sample: " + latest.sampleSize + ", exceptions: " + (latest.exceptionsFound ?? 0) : ""}
            {" | Next test: " + formatDate(latest.nextTestDate)}
          </p>
          <p style={muted}>Conclusion: {latest.conclusionRationale}</p>
        </div>
      )}

      {disabled ? (
        <p style={muted}>This control is marked Not Applicable, so it cannot be tested.</p>
      ) : inProgress ? (
        <div style={inner}>
          <div style={{ ...muted, fontWeight: 600 }}>
            Test in progress - started by {inProgress.tester.displayName} ({inProgress.tester.email}). Only this tester can edit or complete it.
          </div>
          <div style={{ ...grid, marginTop: 10 }}>
            <div>
              <span style={label}>Test method</span>
              <select style={field} value={draft.method} onChange={(e) => update("method", e.target.value)}>
                {METHODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span style={label}>Test date</span>
              <input style={field} type="date" value={draft.testDate} onChange={(e) => update("testDate", e.target.value)} />
            </div>
            <div>
              <span style={label}>Sample size (optional)</span>
              <input style={field} type="number" min={1} value={draft.sampleSize} onChange={(e) => update("sampleSize", e.target.value)} />
            </div>
            <div>
              <span style={label}>Exceptions found (optional)</span>
              <input style={field} type="number" min={0} value={draft.exceptionsFound} onChange={(e) => update("exceptionsFound", e.target.value)} />
            </div>
          </div>
          <span style={label}>Test procedure</span>
          <textarea style={field} rows={2} value={draft.procedure} onChange={(e) => update("procedure", e.target.value)} />

          <span style={label}>Evidence considered (at least one must be Accepted to complete the test)</span>
          {inProgress.evidence.length === 0 && <p style={muted}>No evidence added yet.</p>}
          {inProgress.evidence.map((item) => (
            <p key={item.id} style={{ ...muted, margin: "2px 0" }}>
              {item.evidenceLink.evidenceDocument.displayFilename} ({item.evidenceLink.evidenceDocument.documentType}) - evidence review:{" "}
              {EVIDENCE_LABEL[item.evidenceLink.status] ?? item.evidenceLink.status}
            </p>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <select style={{ ...field, marginBottom: 0 }} value={selectedLink} onChange={(e) => setSelectedLink(e.target.value)}>
              <option value="">Select evidence submitted for this control...</option>
              {addable.map((link) => (
                <option key={link.id} value={link.id}>
                  {link.evidenceDocument.displayFilename} ({EVIDENCE_LABEL[link.status] ?? link.status})
                </option>
              ))}
            </select>
            <button
              style={button}
              disabled={busy || !selectedLink}
              onClick={() =>
                void run(async () => {
                  const saveError = await send("PATCH", `${API}/ai-control-tests/${inProgress.id}`, draftPayload(draft));
                  if (saveError) {
                    return saveError;
                  }
                  return send("POST", `${API}/ai-control-tests/${inProgress.id}/evidence`, { evidenceLinkId: selectedLink });
                }, "Draft saved and evidence added to the test.")
              }
            >
              Add
            </button>
          </div>

          <div style={{ ...grid, marginTop: 12 }}>
            {effSelect("designEffectiveness", "Design effectiveness - is the control designed to address the risk?")}
            {effSelect("operatingEffectiveness", "Operating effectiveness - did it actually operate as designed?")}
            {effSelect("overallEffectiveness", "Overall effectiveness - cannot be better than the weaker of the two")}
          </div>
          <span style={label}>Conclusion rationale</span>
          <textarea
            style={field}
            rows={3}
            placeholder="e.g. Sampled 10 high-impact decisions; 2 had no documented human approval."
            value={draft.conclusionRationale}
            onChange={(e) => update("conclusionRationale", e.target.value)}
          />
          <span style={label}>Next test / retest date (optional)</span>
          <input style={field} type="date" value={draft.nextTestDate} onChange={(e) => update("nextTestDate", e.target.value)} />

          <button
            style={button}
            disabled={busy}
            onClick={() => void run(() => send("PATCH", `${API}/ai-control-tests/${inProgress.id}`, draftPayload(draft)), "Draft saved.")}
          >
            Save draft
          </button>
          <button
            style={{ ...button, background: "#15803d" }}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const saveError = await send("PATCH", `${API}/ai-control-tests/${inProgress.id}`, draftPayload(draft));
                if (saveError) {
                  return saveError;
                }
                return send("POST", `${API}/ai-control-tests/${inProgress.id}/complete`, {});
              }, "Control test completed. It is now a locked historical record.")
            }
          >
            Complete test
          </button>
        </div>
      ) : (
        <div style={inner}>
          <div style={{ ...muted, fontWeight: 600, marginBottom: 8 }}>{latest ? "Start a retest" : "Start a control test"}</div>
          <p style={muted}>Testers: ADMIN, REVIEWER or AUDITOR. The control owner and anyone who submitted or uploaded the evidence cannot test.</p>
          <span style={label}>Test method</span>
          <select style={field} value={draft.method} onChange={(e) => update("method", e.target.value)}>
            {METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <span style={label}>Test procedure</span>
          <textarea
            style={field}
            rows={2}
            placeholder="e.g. Sample 10 high-impact decisions and verify each had documented human approval."
            value={draft.procedure}
            onChange={(e) => update("procedure", e.target.value)}
          />
          <button
            style={button}
            disabled={busy || !draft.procedure}
            onClick={() =>
              void run(
                () => send("POST", `${API}/ai-system-controls/${controlRecordId}/tests`, { method: draft.method, procedure: draft.procedure }),
                latest ? "Retest started." : "Control test started.",
              )
            }
          >
            {latest ? "Start retest" : "Start test"}
          </button>
        </div>
      )}

      <div style={{ ...muted, fontWeight: 600, marginTop: 8 }}>Test history (completed tests are locked)</div>
      {completed.length === 0 && <p style={muted}>No completed tests yet.</p>}
      {completed.map((test, index) => (
        <div key={test.id} style={{ borderTop: "1px solid #1f2937", padding: "10px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>
              Test #{completed.length - index} - {formatDate(test.testDate)} - {methodLabel(test.method)}
            </strong>
            <EffBadge value={test.overallEffectiveness} />
          </div>
          <p style={muted}>
            Tester: {test.tester.displayName} ({test.tester.email}) | Design: {effInfo(test.designEffectiveness).label} | Operating:{" "}
            {effInfo(test.operatingEffectiveness).label}
            {test.sampleSize !== null ? " | Sample: " + test.sampleSize + ", exceptions: " + (test.exceptionsFound ?? 0) : ""}
          </p>
          <p style={muted}>Procedure: {test.procedure}</p>
          <p style={muted}>Conclusion: {test.conclusionRationale}</p>
          <p style={muted}>Evidence considered: {test.evidence.map((item) => item.evidenceLink.evidenceDocument.displayFilename).join(", ")}</p>
        </div>
      ))}
    </section>
  );
}