"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API, control, link } from "../../_lists/ui";
import { Can, useCurrentUser } from "../../current-user";
import IncidentForm, { emptyValues, type Values } from "../incident-form";
type Incident = Values & {
  id: string;
  revision: number;
  status: string;
  aiSystemId: string;
  reporterUserId: string;
  closureSubmitterUserId: string | null;
  detectedAt: string;
  occurredAt: string | null;
  aiSystem: { name: string };
  aiUseCase: { id: string; name: string } | null;
  reporter: { displayName: string };
  owner: { displayName: string } | null;
  evidence?: {
    evidenceDocument: { id: string; displayFilename: string; state: string };
  }[];
  findings: {
    finding: {
      id: string;
      title: string;
      status: string;
      remediation: { title: string; status: string } | null;
    };
  }[];
  reassessment: { id: string; status: string } | null;
  monitoringReview: { id: string; observation: string } | null;
  reviews: {
    id: string;
    decision: string;
    rationale: string;
    createdAt: string;
    reviewer: { displayName: string };
  }[];
};
export default function IncidentDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useCurrentUser();
  const [i, setI] = useState<Incident | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useCases, setUseCases] = useState<{ id: string; name: string }[]>([]);
  const [evidence, setEvidence] = useState<
    { id: string; displayFilename: string; usable: boolean }[]
  >([]);
  const [findings, setFindings] = useState<{ id: string; title: string }[]>([]);
  const [reassessments, setReassessments] = useState<
    { id: string; status: string }[]
  >([]);
  const [evidenceId, setEvidenceId] = useState("");
  const [findingId, setFindingId] = useState("");
  const [reassessmentId, setReassessmentId] = useState("");
  const [whatChanged, setWhatChanged] = useState("");
  const [decision, setDecision] = useState("APPROVED");
  const [rationale, setRationale] = useState("");
  useEffect(() => {
    fetch(`${API}/ai-incidents/${id}`, { credentials: "include" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setI(d);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  const systemId = i?.aiSystemId;
  useEffect(() => {
    if (!systemId) return;
    async function get(path: string) {
      const r = await fetch(`${API}${path}`, { credentials: "include" });
      return r.ok ? r.json() : {};
    }
    get(`/ai-systems/${systemId}/use-cases`)
      .then((d) => setUseCases(d.useCases ?? []))
      .catch(() => setUseCases([]));
    if (can("ai-system:update")) {
      get(`/ai-systems/${systemId}/findings`)
        .then((d) => setFindings(d.findings ?? []))
        .catch(() => setFindings([]));
      get(`/ai-systems/${systemId}/reassessments`)
        .then((d) => setReassessments(d.reassessments ?? []))
        .catch(() => setReassessments([]));
      if (can("evidence:read"))
        get(`/ai-systems/${systemId}/evidence`)
          .then((d) => setEvidence(d.evidence ?? []))
          .catch(() => setEvidence([]));
    }
  }, [systemId, user]);
  async function act(action: string, body: object = {}, method = "POST") {
    if (!i) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(
        `${API}/ai-incidents/${id}${action ? "/" + action : ""}`,
        {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, revision: i.revision }),
        },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setI(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const editable = i?.status === "OPEN" || i?.status === "IN_PROGRESS";
  const independent =
    i &&
    user &&
    ![i.reporterUserId, i.ownerUserId, i.closureSubmitterUserId].includes(
      user.userId,
    );
  return (
    <main
      style={{ padding: 32, maxWidth: 1000, margin: "auto", color: "#e6e9f0" }}
    >
      <a style={link} href="/ai-incidents">
        AI Incidents
      </a>
      {error && (
        <p role="alert" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
      {!i ? (
        <p>Loading incident...</p>
      ) : (
        <>
          <h1>{i.title}</h1>
          <p>
            <a style={link} href={`/ai-systems/${i.aiSystemId}`}>
              {i.aiSystem.name}
            </a>{" "}
            � {i.severity} � {i.status}
          </p>
          {i.aiUseCase && (
            <p>
              AI use case:{" "}
              <a style={link} href={`/ai-use-cases/${i.aiUseCase.id}`}>
                {i.aiUseCase.name}
              </a>
            </p>
          )}
          <p>
            Reporter: {i.reporter.displayName} � Owner:{" "}
            {i.owner?.displayName ?? "Unassigned"}
          </p>
          <p>
            Detected: {i.detectedAt}
            {i.occurredAt && ` � Occurred: ${i.occurredAt}`}
          </p>
          {editable && can("ai-system:update") ? (
            <IncidentForm
              aiSystemId={i.aiSystemId}
              key={i.revision}
              editing
              initial={{ ...emptyValues, ...i }}
              useCases={useCases}
              onSave={(v) => act("", v, "PATCH")}
            />
          ) : (
            <>
              {(
                [
                  "description",
                  "investigationSummary",
                  "responseSummary",
                  "followUpPlan",
                  "closureRationale",
                ] as const
              ).map((f) => (
                <section key={f}>
                  <h3>{f.replace(/([A-Z])/g, " $1")}</h3>
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {i[f] || "Not recorded"}
                  </p>
                </section>
              ))}
            </>
          )}
          <Can permission="ai-system:update">
            {i.status === "OPEN" && (
              <button
                style={control}
                disabled={busy || !i.ownerUserId}
                onClick={() => act("start")}
              >
                Start investigation
              </button>
            )}
            {i.status === "IN_PROGRESS" && user?.userId === i.ownerUserId && (
              <button
                style={control}
                disabled={busy}
                onClick={() => act("submit-closure")}
              >
                Submit closure for independent review
              </button>
            )}
          </Can>
          {i.status === "PENDING_REVIEW" && (
            <section>
              <h2>Independent closure review</h2>
              {can("ai-incident:review") && independent ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act("review", { decision, rationale });
                  }}
                >
                  <select
                    style={control}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                  >
                    {["APPROVED", "REJECTED", "CHANGES_REQUESTED"].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </select>
                  <textarea
                    aria-label="Review rationale"
                    style={control}
                    required
                    maxLength={4000}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                  />
                  <button style={control} disabled={busy}>
                    Record decision
                  </button>
                </form>
              ) : (
                <p>
                  The reviewer must have review permission and must not be the
                  reporter, owner or closure submitter.
                </p>
              )}
            </section>
          )}
          <h2>Evidence</h2>
          {i.evidence ? (
            i.evidence.map((e) => (
              <p key={e.evidenceDocument.id}>
                {e.evidenceDocument.displayFilename} �{" "}
                {e.evidenceDocument.state}
              </p>
            ))
          ) : (
            <p>Your role does not permit evidence metadata access.</p>
          )}
          <p>File access remains governed by existing evidence permissions.</p>
          {editable && can("ai-system:update") && can("evidence:read") && (
            <>
              <select
                aria-label="Existing evidence"
                style={control}
                value={evidenceId}
                onChange={(e) => setEvidenceId(e.target.value)}
              >
                <option value="">Choose eligible evidence</option>
                {evidence
                  .filter((d) => d.usable)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayFilename}
                    </option>
                  ))}
              </select>
              <button
                style={control}
                disabled={busy || !evidenceId}
                onClick={() =>
                  act("evidence", { evidenceDocumentId: evidenceId })
                }
              >
                Link evidence
              </button>
            </>
          )}
          <h2>Findings and remediation</h2>
          {i.findings.map(({ finding: f }) => (
            <p key={f.id} id={"finding-" + f.id}>
              <a style={link} href={`/ai-systems/${i.aiSystemId}/findings`}>
                {f.title}
              </a>{" "}
              � {f.status}
              {f.remediation &&
                ` � ${f.remediation.title}: ${f.remediation.status}`}
            </p>
          ))}
          {editable && can("ai-system:update") && (
            <>
              <select
                aria-label="Existing finding"
                style={control}
                value={findingId}
                onChange={(e) => setFindingId(e.target.value)}
              >
                <option value="">Choose existing finding</option>
                {findings.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
              <button
                style={control}
                disabled={busy || !findingId}
                onClick={() => act("findings", { findingId })}
              >
                Link finding
              </button>
            </>
          )}
          <h2>Reassessment</h2>
          {i.reassessment ? (
            <a style={link} href={`/ai-systems/${i.aiSystemId}/reassessments/${i.reassessment.id}`}>
              Reassessment � {i.reassessment.status}
            </a>
          ) : editable && can("ai-system:update") ? (
            <>
              <input
                aria-label="What changed"
                style={control}
                placeholder="What needs reassessment?"
                maxLength={4000}
                value={whatChanged}
                onChange={(e) => setWhatChanged(e.target.value)}
              />
              <button
                style={control}
                disabled={busy || !whatChanged.trim()}
                onClick={() =>
                  act("reassessment", { action: "START", whatChanged })
                }
              >
                Start reassessment
              </button>
              <select
                aria-label="Existing reassessment"
                style={control}
                value={reassessmentId}
                onChange={(e) => setReassessmentId(e.target.value)}
              >
                <option value="">Choose existing cycle</option>
                {reassessments.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.id} � {r.status}
                  </option>
                ))}
              </select>
              <button
                style={control}
                disabled={busy || !reassessmentId}
                onClick={() =>
                  act("reassessment", { action: "LINK", reassessmentId })
                }
              >
                Link existing cycle
              </button>
            </>
          ) : (
            <p>No reassessment linked</p>
          )}
          {i.monitoringReview && (
            <p>Source monitoring review: {i.monitoringReview.observation}</p>
          )}
          <h2>Closure review history</h2>
          {i.reviews.length === 0 && <p>No closure decisions recorded.</p>}
          {i.reviews.map((r) => (
            <section key={r.id}>
              <p>
                {r.decision} � {r.reviewer.displayName} � {r.createdAt}
              </p>
              <p>{r.rationale}</p>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
