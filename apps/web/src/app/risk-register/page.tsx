"use client";

import { useMemo, useState } from "react";
import { Badge, ListPage, control, formatDate, link, systemOptions, td, th, useList, words } from "../_lists/ui";

type UserRef = { displayName: string } | null;
type Risk = {
  id: string;
  title: string;
  category: string;
  inherentScore: number;
  inherentRating: string;
  residualScore: number | null;
  residualRating: string | null;
  treatment: string | null;
  treatmentOwner: UserRef;
  acceptanceState: string;
  aiSystem: { id: string; name: string };
  assessment: { id: string; version: number; status: string; posture: string };
};
const POSTURE: Record<string, { text: string; color: string }> = {
  LATEST_ASSESSED: { text: "Latest assessed", color: "#4ade80" },
  DRAFT_NO_COMPLETED_ASSESSMENT: { text: "DRAFT - NO COMPLETED ASSESSMENT", color: "#fbbf24" },
  OTHER_VERSION: { text: "Other version", color: "#94a3b8" },
};

export default function RiskRegisterPage() {
  const [scope, setScope] = useState("latest");
  const [system, setSystem] = useState("");
  const [band, setBand] = useState("");
  const { data, error } = useList<{ risks: Risk[] }>(`/ai-risks?scope=${scope}`);
  const all = data?.risks ?? [];
  const rows = useMemo(() => all.filter((r) => (!system || r.aiSystem.id === system) && (!band || r.residualRating === band)), [all, system, band]);
  return (
    <ListPage
      title="Risk Register"
      purpose="Latest assessed posture: risks from each AI system's latest COMPLETED risk assessment. It is an assessment snapshot, not real-time monitoring. Planned treatment is a plan; only an approved Risk Acceptance is authoritative."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "No assessed risks yet. Start a Risk Assessment from an AI System." : null}
      controls={
        <>
          <select style={control} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="latest">Latest assessed posture</option>
            <option value="all">Include all assessment versions (history)</option>
          </select>
          <select style={control} value={system} onChange={(e) => setSystem(e.target.value)}>
            <option value="">All AI systems</option>
            {systemOptions(all).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select style={control} value={band} onChange={(e) => setBand(e.target.value)}>
            <option value="">Any residual band</option>
            {["LOW", "MODERATE", "HIGH", "CRITICAL"].map((b) => (
              <option key={b} value={b}>
                {words(b)}
              </option>
            ))}
          </select>
        </>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["AI system", "Risk", "Category", "Inherent", "Residual", "Planned treatment", "Treatment owner", "Risk Acceptance", "Assessment"].map((h) => (
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
                <a style={link} href={`/ai-risk-assessments/${r.assessment.id}`}>
                  {r.title}
                </a>
              </td>
              <td style={td}>{words(r.category)}</td>
              <td style={td}>{r.inherentScore + " (" + words(r.inherentRating) + ")"}</td>
              <td style={td}>{r.residualScore === null ? "not assessed" : r.residualScore + " (" + words(r.residualRating) + ")"}</td>
              <td style={td}>{words(r.treatment)}</td>
              <td style={td}>{r.treatmentOwner?.displayName ?? "-"}</td>
              <td style={td}>
                <a style={link} href={`/risk-acceptance/${r.id}`}>
                  {r.acceptanceState === "NONE" ? "none" : words(r.acceptanceState)}
                </a>
              </td>
              <td style={td}>
                {"v" + r.assessment.version + " " + words(r.assessment.status) + " "}
                <Badge text={POSTURE[r.assessment.posture]?.text ?? r.assessment.posture} color={POSTURE[r.assessment.posture]?.color ?? "#94a3b8"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "#8b96ac", fontSize: 12 }}>Showing {rows.length} risk(s). Data as of {formatDate(new Date().toISOString())}.</p>
    </ListPage>
  );
}