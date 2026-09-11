"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type ReportData = {
  vendor: { id: string; legalName: string; tradingName: string | null };
  assessment: { id: string; status: string; createdAt: string } | null;
  riskRating: { inherentScore: number; controlEffectiveness: number; residualScore: number; finalRating: string } | null;
  previousRiskRating: { inherentScore: number; controlEffectiveness: number; residualScore: number; finalRating: string } | null;
  findings: {
    total: number;
    openCount: number;
    closedCount: number;
    reviewedOpenCount: number;
    highCriticalOpen: {
      id: string;
      controlId: string;
      controlTitle: string;
      severity: string;
      impactType: string;
      status: string;
      reviewed: boolean;
      gaps: string[];
    }[];
  };
  remediation: {
    counts: { open: number; inProgress: number; overdue: number; closed: number; total: number };
    overdueItems: { id: string; title: string; linkedFindingControlId: string | null; linkedFindingSeverity: string | null }[];
  };
  frameworkCoverage: { framework: string; applicable: number; assessed: number; coveragePercent: number }[];
  evidenceStatus: { total: number; current: number; expiringSoon: number; expired: number };
};

const box = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 18, marginBottom: 18 };
const label = { color: "#8b96ac", fontSize: 12, marginBottom: 4 };
const value = { fontSize: 20, fontWeight: 700 };
const heading = { fontSize: 16, fontWeight: 700, marginBottom: 10 };

function severityColor(sev: string): string {
  if (sev === "CRITICAL") return "#dc2626";
  if (sev === "HIGH") return "#ea580c";
  return "#8b96ac";
}

export default function ExecutiveReportPage() {
  const params = useParams();
  const vendorId = params.id as string;
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/executive-report`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("Could not load the executive report for this vendor.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReport(data);
      setLoading(false);
    }
    load();
  }, [vendorId]);

  if (loading) return <main style={{ maxWidth: 900, margin: "0 auto", padding: 32, color: "#8b96ac" }}>Loading...</main>;
  if (error || !report) return <main style={{ maxWidth: 900, margin: "0 auto", padding: 32, color: "#f87171" }}>{error || "No data."}</main>;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ color: "#dc2626", fontSize: 11, fontWeight: 700, textAlign: "center", marginBottom: 12 }}>
        CONFIDENTIAL - INTERNAL USE ONLY
      </div>
      <h1 style={{ fontSize: 26, marginBottom: 2 }}>Executive Risk Report</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 20 }}>
        {report.vendor.legalName} &middot; Generated {new Date().toLocaleDateString()}
      </p>

      <a href={`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/executive-report/export`}
        style={{
          display: "inline-block",
          background: "#3b82f6",
          color: "#fff",
          textDecoration: "none",
          borderRadius: 8,
          padding: "9px 18px",
          fontSize: 13,
          fontWeight: 700,
          marginBottom: 20,
        }}
      >
        Download PDF
      </a>

      <div style={box}>
        <div style={heading}>Overall Risk Rating</div>
        {report.riskRating ? (
          <>
            <div style={{ ...value, fontSize: 32, color: severityColor(report.riskRating.finalRating) }}>
              {report.riskRating.finalRating}
            </div>
            <div style={{ display: "flex", gap: 24, marginTop: 10 }}>
              <div><div style={label}>Inherent</div><div style={value}>{report.riskRating.inherentScore}</div></div>
              <div><div style={label}>Control Effectiveness</div><div style={value}>{report.riskRating.controlEffectiveness}%</div></div>
              <div><div style={label}>Residual</div><div style={value}>{report.riskRating.residualScore}</div></div>
            </div>
            {report.previousRiskRating && (
              <div style={{ ...label, marginTop: 10 }}>
                Previous cycle - Rating: {report.previousRiskRating.finalRating}, Residual: {report.previousRiskRating.residualScore}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#8b96ac", fontStyle: "italic" }}>No risk rating has been recorded for this vendor yet.</div>
        )}
      </div>

      <div style={box}>
        <div style={heading}>Findings Summary</div>
        <div style={{ display: "flex", gap: 24 }}>
          <div><div style={label}>Total</div><div style={value}>{report.findings.total}</div></div>
          <div><div style={label}>Open</div><div style={value}>{report.findings.openCount}</div></div>
          <div><div style={label}>Closed</div><div style={value}>{report.findings.closedCount}</div></div>
          <div><div style={label}>Reviewed (of open)</div><div style={value}>{report.findings.reviewedOpenCount} of {report.findings.openCount}</div></div>
        </div>
      </div>

      {report.findings.highCriticalOpen.length > 0 && (
        <div style={box}>
          <div style={heading}>High and Critical Findings (Open)</div>
          {report.findings.highCriticalOpen.map((f) => (
            <div key={f.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #2e3d63" }}>
              <span style={{ color: severityColor(f.severity), fontWeight: 700, fontSize: 12 }}>{f.severity}</span>
              <span style={{ marginLeft: 8, fontWeight: 600 }}>{f.controlId} - {f.controlTitle}</span>
              <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 4 }}>
                Impact: {f.impactType} &middot; Reviewed: {f.reviewed ? "Yes" : "No"}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={box}>
        <div style={heading}>Remediation Status</div>
        <div style={{ display: "flex", gap: 24 }}>
          <div><div style={label}>Open</div><div style={value}>{report.remediation.counts.open}</div></div>
          <div><div style={label}>In Progress</div><div style={value}>{report.remediation.counts.inProgress}</div></div>
          <div><div style={label}>Overdue</div><div style={{ ...value, color: report.remediation.counts.overdue > 0 ? "#dc2626" : undefined }}>{report.remediation.counts.overdue}</div></div>
          <div><div style={label}>Closed</div><div style={value}>{report.remediation.counts.closed}</div></div>
        </div>
      </div>

      <div style={box}>
        <div style={heading}>Framework and Control Coverage</div>
        {report.frameworkCoverage.map((fw) => (
          <div key={fw.framework} style={{ fontSize: 13, marginBottom: 6 }}>
            {fw.framework}: {fw.assessed} of {fw.applicable} assessed ({fw.coveragePercent}%)
          </div>
        ))}
      </div>

      <div style={box}>
        <div style={heading}>Evidence Status</div>
        <div style={{ display: "flex", gap: 24 }}>
          <div><div style={label}>Total</div><div style={value}>{report.evidenceStatus.total}</div></div>
          <div><div style={label}>Current</div><div style={value}>{report.evidenceStatus.current}</div></div>
          <div><div style={label}>Expiring Soon</div><div style={value}>{report.evidenceStatus.expiringSoon}</div></div>
          <div><div style={label}>Expired</div><div style={{ ...value, color: report.evidenceStatus.expired > 0 ? "#ea580c" : undefined }}>{report.evidenceStatus.expired}</div></div>
        </div>
      </div>

      <p style={{ color: "#8b96ac", fontSize: 11, fontStyle: "italic", marginTop: 20 }}>
        All data above is sourced directly from VendorGuard's database, not AI-generated. This report view is logged to the audit trail.
      </p>
    </main>
  );
}