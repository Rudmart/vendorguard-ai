"use client";
import { useState } from "react";
import MonitoringReviewSelect from "./monitoring-review-select";
import TenantUserSelect from "../tenant-user-select";
import { control } from "../_lists/ui";
export const statuses = ["OPEN", "IN_PROGRESS", "PENDING_REVIEW", "CLOSED"];
export const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
export type Values = {
  title: string;
  description: string;
  severity: string;
  ownerUserId: string;
  aiUseCaseId: string;
  monitoringReviewId: string;
  investigationSummary: string;
  responseSummary: string;
  followUpPlan: string;
  closureRationale: string;
};
export const emptyValues: Values = {
  title: "",
  description: "",
  severity: "MEDIUM",
  ownerUserId: "",
  aiUseCaseId: "",
  monitoringReviewId: "",
  investigationSummary: "",
  responseSummary: "",
  followUpPlan: "",
  closureRationale: "",
};
export default function IncidentForm({
  aiSystemId,
  initial,
  useCases,
  editing,
  onSave,
}: {
  aiSystemId: string;
  initial: Values;
  useCases: { id: string; name: string }[];
  editing?: boolean;
  onSave: (
    v: Values,
    detectedAt: string,
    occurredAt: string | null,
  ) => Promise<void>;
}) {
  const [v, setV] = useState<Values>(
    () =>
      Object.fromEntries(
        Object.keys(emptyValues).map((k) => [
          k,
          initial[k as keyof Values] ?? "",
        ]),
      ) as Values,
  );
  const [detected, setDetected] = useState(
    new Date().toISOString().slice(0, 16),
  );
  const [occurred, setOccurred] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(
            v,
            new Date(detected + "Z").toISOString(),
            occurred ? new Date(occurred + "Z").toISOString() : null,
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>
        <label>
          Title *{" "}
          <input
            style={control}
            required
            maxLength={200}
            value={v.title}
            onChange={(e) => setV({ ...v, title: e.target.value })}
          />
        </label>
      </p>
      <p>
        <label>
          Description *{" "}
          <textarea
            style={control}
            required
            maxLength={4000}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        </label>
      </p>
      {!editing && (
        <p>
          <label>
            Detected at (UTC) *{" "}
            <input
              style={control}
              required
              type="datetime-local"
              value={detected}
              onChange={(e) => setDetected(e.target.value)}
            />
          </label>
        </p>
      )}
      {!editing && (
        <p>
          <label>
            Occurred at (UTC, optional){" "}
            <input
              style={control}
              type="datetime-local"
              value={occurred}
              onChange={(e) => setOccurred(e.target.value)}
            />
          </label>
        </p>
      )}
      <p>
        <label>
          Severity{" "}
          <select
            style={control}
            value={v.severity}
            onChange={(e) => setV({ ...v, severity: e.target.value })}
          >
            {severities.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Owner{" "}
          <TenantUserSelect
            requiredPermission="ai-system:update"
            value={v.ownerUserId}
            onChange={(ownerUserId) => setV({ ...v, ownerUserId })}
            style={control}
          />
        </label>
      </p>
      <p>
        <label>
          AI use case{" "}
          <select
            style={control}
            value={v.aiUseCaseId}
            onChange={(e) => setV({ ...v, aiUseCaseId: e.target.value })}
          >
            <option value="">No specific use case</option>
            {useCases.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Source monitoring review (optional){" "}
          <MonitoringReviewSelect
            aiSystemId={aiSystemId}
            value={v.monitoringReviewId}
            onChange={(monitoringReviewId) =>
              setV({ ...v, monitoringReviewId })
            }
          />
        </label>
      </p>
      {editing &&
        (
          [
            ["investigationSummary", "Investigation summary"],
            ["responseSummary", "Response summary"],
            [
              "followUpPlan",
              "Follow-up disposition (linked work and responsible owner, or no further action)",
            ],
            ["closureRationale", "Closure rationale"],
          ] as const
        ).map(([field, label]) => (
          <p key={field}>
            <label>
              {label}
              <br />
              <textarea
                style={{ ...control, width: "90%" }}
                maxLength={4000}
                value={v[field]}
                onChange={(e) => setV({ ...v, [field]: e.target.value })}
              />
            </label>
          </p>
        ))}
      <button style={control} disabled={busy}>
        {busy
          ? "Saving..."
          : editing
            ? "Save investigation"
            : "Register incident"}
      </button>
    </form>
  );
}
