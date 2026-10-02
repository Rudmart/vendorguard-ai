"use client";

import { useMemo, useState } from "react";
import { ListPage, control, link, systemOptions, td, th, useList, words } from "../_lists/ui";

type Row = {
  id: string;
  title: string;
  severity: string;
  status: string;
  owner: { displayName: string } | null;
  ageDays: number;
  aiSystem: { id: string; name: string } | null;
  control: { controlId: string; title: string } | null;
  remediation: { id: string; status: string } | null;
};

export default function FindingsPage() {
  const [status, setStatus] = useState("active");
  const [system, setSystem] = useState("");
  const [severity, setSeverity] = useState("");
  const { data, error } = useList<{ findings: Row[] }>(status === "all" ? "/governance-findings?status=all" : "/governance-findings");
  const all = data?.findings ?? [];
  const rows = useMemo(() => all.filter((r) => (!system || r.aiSystem?.id === system) && (!severity || r.severity === severity)), [all, system, severity]);
  return (
    <ListPage
      title="Findings"
      purpose="AI governance Findings from control testing (vendor assessment findings stay in the vendor workflow). A Finding and its Remediation are separate records; a Finding closes only through verified remediation."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? (status === "all" ? "No Findings yet. Findings are raised from completed control tests." : "No open Findings.") : null}
      controls={
        <>
          <select style={control} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Open and pending review</option>
            <option value="all">All (incl. closed and dismissed)</option>
          </select>
          <select style={control} value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All AI systems</option>
            {systemOptions(all).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={control} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Any severity</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => (
              <option key={s} value={s}>
                {words(s)}
              </option>
            ))}
          </select>
        </>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["AI system", "Finding", "Severity", "Status", "Owner", "Age", "Source control", "Remediation"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.aiSystem?.name ?? "-"}</td>
              <td style={td}>
                {r.aiSystem ? (
                  <a style={link} href={`/ai-systems/${r.aiSystem.id}/findings`}>
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
              </td>
              <td style={td}>{words(r.severity)}</td>
              <td style={td}>{words(r.status)}</td>
              <td style={td}>{r.owner?.displayName ?? "-"}</td>
              <td style={td}>{r.ageDays + " days"}</td>
              <td style={td}>{r.control ? r.control.controlId + " - " + r.control.title : "-"}</td>
              <td style={td}>{r.remediation ? words(r.remediation.status) : "none"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}