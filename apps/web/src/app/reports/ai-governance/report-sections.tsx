"use client";
import type { GovernanceReport } from "@vendorguard/shared";
import { muted } from "../../_lists/ui";
export default function ReportSections({
  report,
}: {
  report: GovernanceReport;
}) {
  const sections = [...new Set(report.metrics.map((m) => m.section))];
  return (
    <div>
      <p style={muted}>
        Generated UTC: {report.generatedAt} · Definition{" "}
        {report.definitionVersion} · Scope: {report.scope.lifecycleScope}
      </p>
      {report.limitations.map((text) => (
        <p key={text} style={muted}>
          {text}
        </p>
      ))}
      {sections.map((section) => (
        <section key={section} style={{ marginBottom: 24 }}>
          <h2>{section}</h2>
          {report.metrics
            .filter((m) => m.section === section)
            .map((m) => (
              <div
                key={m.key}
                style={{ padding: 12, borderBottom: "1px solid #2e3d63" }}
              >
                <strong>{m.label}: </strong>
                {m.access === "RESTRICTED" ? (
                  <span>Restricted</span>
                ) : (
                  <a href={m.drillDown} style={{ color: "#93c5fd" }}>
                    {m.value}
                    {m.denominator === null ? "" : " / " + m.denominator}{" "}
                    {m.unit}
                  </a>
                )}
                <div style={muted}>
                  {m.definition} · Lifecycle: {m.lifecycleScope}
                </div>
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}
