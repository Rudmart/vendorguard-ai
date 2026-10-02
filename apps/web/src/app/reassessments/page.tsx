"use client";

import { useMemo, useState } from "react";
import { Badge, ListPage, control, formatDate, link, systemOptions, td, th, useList, words } from "../_lists/ui";

type Row = {
  id: string;
  reason: string;
  status: string;
  materialChange: boolean;
  targetDate: string | null;
  pastTarget: boolean;
  conclusion: string | null;
  initiatedBy: { displayName: string } | null;
  createdAt: string;
  completedAt: string | null;
  aiSystem: { id: string; name: string };
};

export default function ReassessmentsPage() {
  const [system, setSystem] = useState("");
  const [status, setStatus] = useState("");
  const { data, error } = useList<{ reassessments: Row[] }>("/ai-reassessments");
  const all = data?.reassessments ?? [];
  const rows = useMemo(() => all.filter((r) => (!system || r.aiSystem.id === system) && (!status || r.status === status)), [all, system, status]);
  return (
    <ListPage
      title="Reassessments"
      purpose="Governed review cycles across AI systems. In-progress cycles first, then completed cycles newest first. Each reassessment is started and completed on its AI system."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "No reassessments yet. Reassessments are started from an AI System or a monitoring review." : null}
      controls={
        <>
          <select style={control} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="COMPLETED">Completed</option>
          </select>
          <select style={control} value={system} onChange={(e) => setSystem(e.target.value)}>
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
            {["AI system", "Reason", "Status", "Material change", "Target", "Conclusion", "Initiated by", "Started", "Completed"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={td}>{r.aiSystem.name}</td>
              <td style={td}>
                <a style={link} href={`/ai-systems/${r.aiSystem.id}/reassessments/${r.id}`}>
                  {words(r.reason)}
                </a>
              </td>
              <td style={td}>{words(r.status)}</td>
              <td style={td}>{r.materialChange ? "yes" : "no"}</td>
              <td style={td}>
                {formatDate(r.targetDate) + " "}
                {r.pastTarget && <Badge text="past target" color="#f87171" />}
              </td>
              <td style={td}>{words(r.conclusion)}</td>
              <td style={td}>{r.initiatedBy?.displayName ?? "-"}</td>
              <td style={td}>{formatDate(r.createdAt)}</td>
              <td style={td}>{formatDate(r.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}