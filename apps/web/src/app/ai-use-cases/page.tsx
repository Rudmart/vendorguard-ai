"use client";

import { useEffect, useMemo, useState } from "react";
import { API, Badge, ListPage, control, formatDate, link, systemOptions, td, th, useList } from "../_lists/ui";
import { Can } from "../current-user";
import UseCaseForm, { EMPTY_VALUES, STATUS_COLORS, inputStyle, labelStyle, primaryButton, readable, toPayload } from "./use-case-form";

type Row = {
  id: string;
  name: string;
  status: string;
  decisionRole: string | null;
  updatedAt: string;
  aiSystem: { id: string; name: string };
  owner: { displayName: string } | null;
};

const STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "SUSPENDED", "RETIRED"];

/** Inline registration (AI governance pattern - same as AI Inventory). The API re-checks permission, tenant and owner. */
function RegisterUseCase({ presetSystemId }: { presetSystemId: string }) {
  const [open, setOpen] = useState(Boolean(presetSystemId));
  const [systems, setSystems] = useState<{ id: string; name: string }[] | null>(null);
  const [aiSystemId, setAiSystemId] = useState(presetSystemId);

  useEffect(() => {
    setAiSystemId(presetSystemId);
    setOpen((o) => o || Boolean(presetSystemId));
  }, [presetSystemId]);

  useEffect(() => {
    if (!open || systems !== null) {
      return;
    }
    fetch(`${API}/ai-systems`, { credentials: "include" })
      .then(async (res) => setSystems(res.ok ? (((await res.json()) as { aiSystems?: { id: string; name: string }[] }).aiSystems ?? []) : []))
      .catch(() => setSystems([]));
  }, [open, systems]);

  async function create(values: typeof EMPTY_VALUES): Promise<string | null> {
    if (!aiSystemId) {
      return "Choose the AI system this use case belongs to.";
    }
    try {
      const res = await fetch(`${API}/ai-systems/${aiSystemId}/use-cases`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(values)),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        return data?.error ?? `Could not register the use case (${res.status}).`;
      }
      window.location.href = `/ai-use-cases/${data.id}`;
      return null;
    } catch {
      return "Could not reach the server. Check that the API is running.";
    }
  }

  return (
    <div style={{ margin: "8px 0 16px 0" }}>
      <button type="button" onClick={() => setOpen(!open)} style={primaryButton}>
        + Register AI Use Case
      </button>
      {open && (
        <div style={{ marginTop: 16 }}>
          <UseCaseForm
            initial={EMPTY_VALUES}
            submitLabel="Save as draft"
            onSubmit={create}
            onCancel={() => setOpen(false)}
            header={
              <label style={labelStyle}>
                AI system *
                <select style={inputStyle} value={aiSystemId} onChange={(e) => setAiSystemId(e.target.value)} disabled={systems === null}>
                  <option value="">{systems === null ? "Loading AI systems..." : "Choose an AI system"}</option>
                  {(systems ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
        </div>
      )}
    </div>
  );
}

export default function AiUseCasesPage() {
  const [status, setStatus] = useState("");
  const [system, setSystem] = useState("");
  const [presetSystemId, setPresetSystemId] = useState("");

  // Deep links: /ai-use-cases?status=PENDING_REVIEW (review work) and ?aiSystemId=... (register from an AI system).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("status");
    if (s && STATUSES.includes(s)) {
      setStatus(s);
    }
    setPresetSystemId(params.get("aiSystemId") ?? "");
  }, []);

  const { data, error } = useList<{ useCases: Row[] }>(status ? `/ai-use-cases?status=${status}` : "/ai-use-cases");
  const all = data?.useCases ?? [];
  const rows = useMemo(() => all.filter((r) => !system || r.aiSystem.id === system), [all, system]);

  return (
    <ListPage
      title="AI Use Cases"
      purpose="How and why each AI system is used: business purpose, accountable owner, decision role and human oversight. A use case is approved by a human reviewer - AI assists, humans govern."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? (status ? `No use cases with status "${readable(status)}".` : "No AI use cases yet. Register one for an AI system.") : null}
      controls={
        <>
          <Can permission="ai-system:update">
            <RegisterUseCase presetSystemId={presetSystemId} />
          </Can>
          <select aria-label="Filter by status" style={control} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {readable(s)}
              </option>
            ))}
          </select>
          <select aria-label="Filter by AI system" style={control} value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All AI systems</option>
            {systemOptions(all).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Use case", "AI system", "Owner", "Decision role", "Status", "Updated"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>
                <a style={link} href={`/ai-use-cases/${r.id}`}>
                  {r.name}
                </a>
              </td>
              <td style={td}>
                <a style={link} href={`/ai-systems/${r.aiSystem.id}`}>
                  {r.aiSystem.name}
                </a>
              </td>
              <td style={td}>{r.owner?.displayName ?? "-"}</td>
              <td style={td}>{readable(r.decisionRole)}</td>
              <td style={td}>
                <Badge text={readable(r.status)} color={STATUS_COLORS[r.status] ?? "#8b96ac"} />
              </td>
              <td style={td}>{formatDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}
