"use client";

import { useMemo, useState } from "react";
import { Badge, ListPage, control, formatDate, link, systemOptions, td, th, useList, words } from "../_lists/ui";

type Row = {
  id: string;
  title: string;
  category: string;
  cadence: string;
  active: boolean;
  aiSystem: { id: string; name: string };
  owner: { displayName: string } | null;
  nextDueAt: string;
  dueState: string;
  lastReview: { reviewedAt: string; result: string } | null;
};
const DUE: Record<string, string> = { OVERDUE: "#f87171", DUE_SOON: "#fbbf24", NOT_DUE: "#4ade80", INACTIVE: "#94a3b8" };

export default function GovernanceMonitoringPage() {
  const [active, setActive] = useState("active");
  const [system, setSystem] = useState("");
  const [due, setDue] = useState("");
  const { data, error } = useList<{ checks: Row[] }>(active === "all" ? "/ai-monitoring-checks?active=all" : "/ai-monitoring-checks");
  const all = data?.checks ?? [];
  const rows = useMemo(() => all.filter((r) => (!system || r.aiSystem.id === system) && (!due || r.dueState === due)), [all, system, due]);
  return (
    <ListPage
      title="Governance Monitoring"
      purpose="Monitoring obligations across AI systems - what must be reviewed, by whom and how often. Governance oversight, not technical telemetry. Reviews are recorded on each check."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "No monitoring checks configured. Monitoring checks are configured from an AI System." : null}
      controls={
        <>
          <select style={control} value={active} onChange={(e) => setActive(e.target.value)}>
            <option value="active">Active checks</option>
            <option value="all">Include inactive</option>
          </select>
          <select style={control} value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All AI systems</option>
            {systemOptions(all).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={control} value={due} onChange={(e) => setDue(e.target.value)}>
            <option value="">Any due state</option>
            {["OVERDUE", "DUE_SOON", "NOT_DUE", "INACTIVE"].map((s) => (
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
            {["Check", "AI system", "Category", "Cadence", "Owner", "Due state", "Next due", "Latest result", "Latest review"].map((h) => (
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
                <a style={link} href={`/ai-systems/${r.aiSystem.id}/monitoring/${r.id}`}>
                  {r.title}
                </a>
              </td>
              <td style={td}>{r.aiSystem.name}</td>
              <td style={td}>{words(r.category)}</td>
              <td style={td}>{words(r.cadence)}</td>
              <td style={td}>{r.owner?.displayName ?? "-"}</td>
              <td style={td}>
                <Badge text={words(r.dueState)} color={DUE[r.dueState] ?? "#94a3b8"} />
              </td>
              <td style={td}>{r.active ? formatDate(r.nextDueAt) : "-"}</td>
              <td style={td}>{r.lastReview ? words(r.lastReview.result) : "not reviewed yet"}</td>
              <td style={td}>{formatDate(r.lastReview?.reviewedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}