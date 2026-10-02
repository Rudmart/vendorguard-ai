"use client";

import { useMemo, useState } from "react";
import { Badge, ListPage, control, formatDate, link, systemOptions, td, th, useList, words } from "../_lists/ui";

type Row = {
  id: string;
  name: string;
  version: number;
  status: string;
  reviewDecision: string | null;
  createdAt: string;
  completedAt: string | null;
  aiSystem: { id: string; name: string };
  assessor: { displayName: string } | null;
  isLatestCompleted: boolean;
};

export default function ImpactAssessmentsPage() {
  const [system, setSystem] = useState("");
  const [latestOnly, setLatestOnly] = useState("all");
  const { data, error } = useList<{ assessments: Row[] }>("/ai-impact-assessments");
  const all = data?.assessments ?? [];
  const rows = useMemo(() => all.filter((r) => (!system || r.aiSystem.id === system) && (latestOnly === "all" || r.isLatestCompleted)), [all, system, latestOnly]);
  return (
    <ListPage
      title="Impact Assessments"
      purpose="Every AI impact assessment version. Completed versions are locked history; the latest completed version per AI system is the latest assessed impact."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "No impact assessments yet. Start one from an AI System." : null}
      controls={
        <>
          <select style={control} value={latestOnly} onChange={(e) => setLatestOnly(e.target.value)}>
            <option value="all">All versions (history)</option>
            <option value="latest">Latest completed only</option>
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
            {["AI system", "Version", "Name", "Status", "Review", "Assessor", "Created", "Completed"].map((h) => (
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
                {"v" + r.version + " "}
                {r.isLatestCompleted && <Badge text="Latest assessed" color="#4ade80" />}
              </td>
              <td style={td}>
                <a style={link} href={`/ai-impact-assessments/${r.id}`}>
                  {r.name}
                </a>
              </td>
              <td style={td}>{words(r.status)}</td>
              <td style={td}>{words(r.reviewDecision)}</td>
              <td style={td}>{r.assessor?.displayName ?? "-"}</td>
              <td style={td}>{formatDate(r.createdAt)}</td>
              <td style={td}>{formatDate(r.completedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}