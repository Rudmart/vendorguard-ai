"use client";
import { useState } from "react";
import type { GovernanceReport, ReportScope } from "@vendorguard/shared";
import { useCurrentUser } from "../../current-user";
import { useList, API, control, ListPage } from "../../_lists/ui";
import ReportSections from "./report-sections";
export default function GovernanceReportPage() {
  const { can } = useCurrentUser();
  const [scope, setScope] = useState<ReportScope>("operational"),
    [system, setSystem] = useState("");
  const query = new URLSearchParams({
    lifecycleScope: scope,
    ...(system ? { aiSystemId: system } : {}),
  }).toString();
  const { data, error } = useList<GovernanceReport>(
    "/reports/ai-governance?" + query,
  );
  const inventory = useList<{ aiSystems: { id: string; name: string }[] }>(
    "/ai-systems",
  );
  return (
    <ListPage
      title="Executive & Governance Reporting"
      purpose="AI ASSISTS. HUMANS GOVERN. Recorded facts, with source traceability; no automatic governance decisions."
      error={error}
      loading={!data && !error}
      empty={null}
      controls={
        <>
          <select
            style={control}
            value={scope}
            onChange={(e) => setScope(e.target.value as ReportScope)}
          >
            <option value="operational">Non-retired operational scope</option>
            <option value="historical">Retired historical scope</option>
            <option value="all">All systems</option>
          </select>
          <select
            style={control}
            value={system}
            onChange={(e) => setSystem(e.target.value)}
          >
            <option value="">Tenant portfolio</option>
            {inventory.data?.aiSystems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {can("report:export") && (
            <a
              href={API + "/reports/ai-governance/export?" + query}
              style={{ color: "#93c5fd" }}
            >
              Download authorized PDF
            </a>
          )}
        </>
      }
    >
      {can("report:read") && data && <ReportSections report={data} />}
    </ListPage>
  );
}
