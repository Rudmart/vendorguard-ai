"use client";
import { useEffect, useState } from "react";
import { API, ListPage, control, td, th, link, useList } from "../_lists/ui";
import { Can } from "../current-user";
import TenantUserSelect from "../tenant-user-select";
import IncidentForm, {
  emptyValues,
  statuses,
  severities,
  type Values,
} from "./incident-form";
type Row = {
  id: string;
  title: string;
  status: string;
  severity: string;
  aiSystem: { name: string };
  owner: { displayName: string } | null;
};
export default function IncidentsPage() {
  const [system, setSystem] = useState("");
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [owner, setOwner] = useState("");
  const [register, setRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systems, setSystems] = useState<{ id: string; name: string }[]>([]);
  const [useCases, setUseCases] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    setSystem(
      new URLSearchParams(window.location.search).get("aiSystemId") ?? "",
    );
    fetch(`${API}/ai-systems`, { credentials: "include" })
      .then(async (r) => {
        if (r.ok) setSystems((await r.json()).aiSystems ?? []);
      })
      .catch(() => setError("Could not load AI systems"));
  }, []);
  useEffect(() => {
    setUseCases([]);
    if (system)
      fetch(`${API}/ai-systems/${system}/use-cases`, { credentials: "include" })
        .then(async (r) => {
          if (r.ok) setUseCases((await r.json()).useCases ?? []);
        })
        .catch(() => setError("Could not load use cases"));
  }, [system]);
  const q = new URLSearchParams({
    aiSystemId: system,
    status,
    severity,
    ownerUserId: owner,
  });
  const list = useList<{ incidents: Row[] }>(`/ai-incidents?${q}`);
  async function create(
    v: Values,
    detectedAt: string,
    occurredAt: string | null,
  ) {
    setError(null);
    if (!system) {
      setError("Choose an AI system first");
      return;
    }
    try {
      const r = await fetch(`${API}/ai-systems/${system}/incidents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: v.title,
          description: v.description,
          severity: v.severity,
          ownerUserId: v.ownerUserId || null,
          aiUseCaseId: v.aiUseCaseId || null,
          monitoringReviewId: v.monitoringReviewId || null,
          detectedAt,
          occurredAt,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error);
        return;
      }
      window.location.href = `/ai-incidents/${d.id}`;
    } catch {
      setError("Could not reach API");
    }
  }
  return (
    <ListPage
      title="AI Incidents"
      purpose="Register actual AI events, investigate and respond, then obtain independent human closure review."
      error={error ?? list.error}
      loading={!list.data}
      empty={null}
      controls={
        <>
          <select
            aria-label="AI system"
            style={control}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          >
            <option value="">All AI systems</option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Status"
            style={control}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Severity"
            style={control}
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All severities</option>
            {severities.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Can permission="ai-system:update">
            <TenantUserSelect
              requiredPermission="ai-system:update"
              value={owner}
              onChange={setOwner}
              emptyLabel="All owners"
              style={control}
            />
            <button style={control} onClick={() => setRegister(!register)}>
              Register incident
            </button>
            {register && (
              <IncidentForm
                aiSystemId={system}
                key={system}
                initial={emptyValues}
                useCases={useCases}
                onSave={create}
              />
            )}
          </Can>
        </>
      }
    >
      <table style={{ width: "100%" }}>
        <thead>
          <tr>
            {["Incident", "AI system", "Severity", "Status", "Owner"].map(
              (t) => (
                <th key={t} style={th}>
                  {t}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {list.data?.incidents.map((i) => (
            <tr key={i.id}>
              <td style={td}>
                <a style={link} href={`/ai-incidents/${i.id}`}>
                  {i.title}
                </a>
              </td>
              <td style={td}>{i.aiSystem.name}</td>
              <td style={td}>{i.severity}</td>
              <td style={td}>{i.status}</td>
              <td style={td}>{i.owner?.displayName ?? "Unassigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.data?.incidents.length === 0 && (
        <p>No incidents match these filters.</p>
      )}
    </ListPage>
  );
}
