"use client";
import { useEffect, useState } from "react";
import { useCurrentUser } from "../current-user";
import { API, control, link } from "../_lists/ui";
type Issue = { key: string; description: string };
type Disposition = {
  key: string;
  remainingWork: string;
  whyProceed: string;
  ownerUserId: string;
  followUpPlan: string;
};
type Fields = {
  reason: string;
  businessJustification: string;
  requestedRetirementDate: string;
  cessationConfirmed: boolean;
  cessationNotApplicableReason: string;
  useCaseDisposition: string;
  monitoringDisposition: string;
  retentionStatement: string;
  warningDispositions: Disposition[];
};
type RecordData = Fields & {
  id: string;
  revision: number;
  status: string;
  cancellationRationale?: string | null;
  aiSystemId: string;
  requesterUserId: string;
  submitterUserId: string | null;
  ownerAtSubmissionUserId: string | null;
  readinessSnapshot: { token: string } | null;
  aiSystem: { name: string; ownerUserId: string | null };
  readiness: { blockers: Issue[]; warnings: Issue[] };
  reviews: {
    id: string;
    decision: string;
    rationale: string;
    createdAt: string;
  }[];
  evidence?: { evidenceDocument: { id: string; displayFilename: string } }[];
};
const defaults: Fields = {
  reason: "NO_LONGER_NEEDED",
  businessJustification: "",
  requestedRetirementDate: new Date().toISOString().slice(0, 10),
  cessationConfirmed: false,
  cessationNotApplicableReason: "",
  useCaseDisposition: "Retire associated use cases and preserve history.",
  monitoringDisposition:
    "Deactivate operational monitoring and preserve reviews.",
  retentionStatement: "Preserve historical governance records and evidence.",
  warningDispositions: [],
};
export default function RetirementPanel({
  systemId,
  retirementId,
}: {
  systemId?: string;
  retirementId?: string;
}) {
  const { user, can } = useCurrentUser();
  const [record, setRecord] = useState<RecordData | null>(null),
    [fields, setFields] = useState<Fields>(defaults),
    [ready, setReady] = useState<{ blockers: Issue[]; warnings: Issue[] }>({
      blockers: [],
      warnings: [],
    }),
    [members, setMembers] = useState<{ id: string; displayName: string }[]>([]),
    [history, setHistory] = useState<{ id: string; status: string }[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rationale, setRationale] = useState(""),
    [acks, setAcks] = useState<string[]>([]),
    [evidenceId, setEvidenceId] = useState(""),
    [documents, setDocuments] = useState<
      { id: string; displayFilename: string; usable: boolean }[]
    >([]);
  const id = record?.aiSystemId ?? systemId;
  const accept = (d: RecordData) => {
    setRecord(d);
    setFields({
      ...d,
      requestedRetirementDate: d.requestedRetirementDate.slice(0, 10),
      cessationNotApplicableReason: d.cessationNotApplicableReason ?? "",
    });
    setReady(d.readiness);
    setAcks([]);
  };
  useEffect(() => {
    if (!retirementId) return;
    fetch(`${API}/ai-retirements/${retirementId}`, { credentials: "include" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error ?? d.message);
        accept(d);
      })
      .catch((e) => setError(e.message));
  }, [retirementId]);
  useEffect(() => {
    if (!id) return;
    async function get(path: string) {
      const r = await fetch(`${API}${path}`, { credentials: "include" });
      if (!r.ok) throw Error("Unable to load retirement context");
      return r.json();
    }
    get(`/ai-systems/${id}/retirement-readiness`)
      .then(setReady)
      .catch((e) => setError(e.message));
    get(`/ai-systems/${id}/retirements`)
      .then((d) => setHistory(d.retirements))
      .catch((e) => setError(e.message));
    get("/tenant-users")
      .then((d) => setMembers(d.users))
      .catch(() => setMembers([]));
    if (can("evidence:read"))
      get(`/ai-systems/${id}/evidence`)
        .then((d) => setDocuments(d.evidence ?? []))
        .catch(() => setDocuments([]));
  }, [id, user]);
  const editable =
    can("ai-system:update") && (!record || record.status === "DRAFT");
  const review =
    record?.status === "PENDING_REVIEW" &&
    can("ai-retirement:review") &&
    ![
      record.requesterUserId,
      record.submitterUserId,
      record.ownerAtSubmissionUserId,
      record.aiSystem.ownerUserId,
    ].includes(user?.userId ?? "");
  const update = (key: keyof Fields, value: unknown) =>
    setFields((f) => ({ ...f, [key]: value }));
  function disposition(key: string, field: keyof Disposition, value: string) {
    setFields((f) => {
      const row = f.warningDispositions.find((d) => d.key === key) ?? {
        key,
        remainingWork: "",
        whyProceed: "",
        ownerUserId: "",
        followUpPlan: "",
      };
      return {
        ...f,
        warningDispositions: [
          ...f.warningDispositions.filter((d) => d.key !== key),
          { ...row, [field]: value },
        ],
      };
    });
  }
  async function action(name: string, payload: object = {}, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const path = record
        ? `/ai-retirements/${record.id}${name ? "/" + name : ""}`
        : `/ai-systems/${id}/retirements`;
      const data = record
        ? { ...payload, revision: record.revision }
        : {
            ...fields,
            cessationNotApplicableReason:
              fields.cessationNotApplicableReason || null,
          };
      const r = await fetch(`${API}${path}`, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error ?? d.message ?? "Operation failed");
      if (!record) window.location.assign(`/ai-retirements/${d.id}`);
      else accept(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 1000, margin: "auto", padding: 24 }}>
      <h1>AI System Retirement</h1>
      <p>
        Permanent retirement requires independent approval. Historical
        governance records are retained.
      </p>
      {id && (
        <a style={link} href={`/ai-systems/${id}`}>
          AI System history
        </a>
      )}
      {error && <p role="alert">{error}</p>}
      {record && (
        <h2>
          {record.aiSystem.name}: {record.status}
        </h2>
      )}
      <h2>Blockers</h2>
      {ready.blockers.length ? (
        ready.blockers.map((w) => <p key={w.key}>{w.description}</p>)
      ) : (
        <p>No current blockers.</p>
      )}
      <fieldset disabled={!editable || busy}>
        <legend>Retirement preparation</legend>
        <label>
          Reason{" "}
          <select
            style={control}
            value={fields.reason}
            onChange={(e) => update("reason", e.target.value)}
          >
            {[
              "REPLACED",
              "NO_LONGER_NEEDED",
              "RISK_OR_COMPLIANCE",
              "VENDOR_SERVICE_ENDED",
              "OTHER",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <p>
          <label>
            Requested retirement date{" "}
            <input
              type="date"
              value={fields.requestedRetirementDate}
              onChange={(e) =>
                update("requestedRetirementDate", e.target.value)
              }
            />
          </label>
        </p>
        {(
          [
            "businessJustification",
            "useCaseDisposition",
            "monitoringDisposition",
            "retentionStatement",
            "cessationNotApplicableReason",
          ] as const
        ).map((k) => (
          <p key={k}>
            <label>
              {
                {
                  businessJustification: "Business justification",
                  useCaseDisposition: "Use-case disposition",
                  monitoringDisposition: "Monitoring disposition",
                  retentionStatement: "Evidence and history retention",
                  cessationNotApplicableReason:
                    "Explanation for a never-deployed system (optional)",
                }[k]
              }
              <textarea
                style={{ ...control, display: "block", width: "100%" }}
                value={fields[k]}
                onChange={(e) => update(k, e.target.value)}
              />
            </label>
          </p>
        ))}
        <label>
          <input
            type="checkbox"
            checked={fields.cessationConfirmed}
            onChange={(e) => update("cessationConfirmed", e.target.checked)}
          />{" "}
          Operational use has ceased
        </label>
      </fieldset>
      <h2>Warnings and accountable follow-up</h2>
      {ready.warnings.map((w) => {
        const d = fields.warningDispositions.find((x) => x.key === w.key);
        return (
          <fieldset key={w.key} disabled={!editable || busy}>
            <legend>{w.description}</legend>
            {(["remainingWork", "whyProceed", "followUpPlan"] as const).map(
              (k) => (
                <p key={k}>
                  <label>
                    {
                      {
                        remainingWork: "What remains unfinished / disposition",
                        whyProceed: "Why retirement should proceed",
                        followUpPlan: "Disposition and follow-up plan",
                      }[k]
                    }
                    <textarea
                      style={{ ...control, display: "block", width: "100%" }}
                      value={d?.[k] ?? ""}
                      onChange={(e) => disposition(w.key, k, e.target.value)}
                    />
                  </label>
                </p>
              ),
            )}
            <label>
              Responsible owner{" "}
              <select
                style={control}
                value={d?.ownerUserId ?? ""}
                onChange={(e) =>
                  disposition(w.key, "ownerUserId", e.target.value)
                }
              >
                <option value="">Select a current tenant member</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        );
      })}
      {editable && (
        <button
          disabled={busy}
          onClick={() =>
            record
              ? action(
                  "",
                  {
                    reason: fields.reason,
                    businessJustification: fields.businessJustification,
                    requestedRetirementDate: fields.requestedRetirementDate,
                    cessationConfirmed: fields.cessationConfirmed,
                    cessationNotApplicableReason:
                      fields.cessationNotApplicableReason || null,
                    useCaseDisposition: fields.useCaseDisposition,
                    monitoringDisposition: fields.monitoringDisposition,
                    retentionStatement: fields.retentionStatement,
                    warningDispositions: fields.warningDispositions,
                  },
                  "PATCH",
                )
              : action("")
          }
        >
          {record ? "Save draft" : "Create draft"}
        </button>
      )}
      {record?.status === "DRAFT" && editable && (
        <section>
          {record.aiSystem.ownerUserId === user?.userId && (
            <button disabled={busy} onClick={() => action("submit")}>
              Submit saved draft
            </button>
          )}
          <p>
            <input
              style={control}
              aria-label="Cancellation rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <button
              disabled={busy || !rationale.trim()}
              onClick={() => action("cancel", { rationale })}
            >
              Cancel draft
            </button>
          </p>
          {can("evidence:read") && (
            <p>
              <select
                value={evidenceId}
                onChange={(e) => setEvidenceId(e.target.value)}
              >
                <option value="">Existing evidence</option>
                {documents
                  .filter((d) => d.usable)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayFilename}
                    </option>
                  ))}
              </select>
              <button
                disabled={busy || !evidenceId}
                onClick={() =>
                  action("evidence", { evidenceDocumentId: evidenceId })
                }
              >
                Link evidence
              </button>
            </p>
          )}
        </section>
      )}
      {review && (
        <section>
          <h2>Independent review</h2>
          <p>
            Approval executes immediately. Changed readiness requires changes
            and resubmission.
          </p>
          {ready.warnings.map((w) => (
            <p key={w.key}>
              <label>
                <input
                  type="checkbox"
                  checked={acks.includes(w.key)}
                  onChange={(e) =>
                    setAcks((a) =>
                      e.target.checked
                        ? [...a, w.key]
                        : a.filter((x) => x !== w.key),
                    )
                  }
                />{" "}
                I acknowledge the documented disposition: {w.description}
              </label>
            </p>
          ))}
          <textarea
            aria-label="Review rationale"
            style={{ ...control, width: "100%" }}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
          {["APPROVED", "REJECTED", "CHANGES_REQUESTED"].map((decision) => (
            <button
              key={decision}
              disabled={
                busy ||
                !rationale.trim() ||
                (decision === "APPROVED" &&
                  (ready.blockers.length > 0 ||
                    acks.length !== ready.warnings.length))
              }
              onClick={() =>
                action("review", {
                  decision,
                  rationale,
                  readinessToken: record?.readinessSnapshot?.token,
                  acknowledgedWarningKeys: acks,
                })
              }
            >
              {decision.replaceAll("_", " ")}
            </button>
          ))}
        </section>
      )}
      {record && (
        <>
          {record.cancellationRationale && (
            <p>Cancellation rationale: {record.cancellationRationale}</p>
          )}
          <h2>Review history</h2>
          {record.reviews.map((r) => (
            <p key={r.id}>
              {r.createdAt}: {r.decision} — {r.rationale}
            </p>
          ))}
          {record.evidence && (
            <>
              <h2>Linked evidence</h2>
              {record.evidence.map((e) => (
                <p key={e.evidenceDocument.id}>
                  {e.evidenceDocument.displayFilename}
                </p>
              ))}
              <p>Existing evidence permissions govern file access.</p>
            </>
          )}
        </>
      )}
      {!record && (
        <>
          <h2>Request history</h2>
          {history.map((h) => (
            <p key={h.id}>
              <a style={link} href={`/ai-retirements/${h.id}`}>
                {h.status}
              </a>
            </p>
          ))}
        </>
      )}
    </main>
  );
}
