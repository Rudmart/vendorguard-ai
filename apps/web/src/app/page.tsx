"use client";

import type { CSSProperties } from "react";
import { muted, useList } from "./_lists/ui";

// Alignment Phase C: AI governance posture + attention dashboard. Read-only; every number links to its real page.
type Summary = {
  attention: Record<string, number>;
  posture: { aiSystems: number; inProduction: number; withoutCompletedRiskAssessment: number; withoutCompletedImpactAssessment: number; latestAssessedResidualRisk: Record<string, number>; aiRemediationOpen: number; riskAcceptanceActive: number; reassessmentsInProgress: number; monitoringChecksActive: number };
  thirdParty: { vendors: number; aiVendors: number; openVendorRemediation: number } | null;
  acceptanceExpiringDays: number;
};
type Card = { label: string; value: number; href: string; warn?: boolean };

const card: CSSProperties = { display: "block", background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: "14px 16px", textDecoration: "none", color: "#e6e9f0", minWidth: 180 };

function Section({ title, cards }: { title: string; cards: Card[] }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 10px 0" }}>{title}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {cards.map((c) => (
          <a key={c.label} href={c.href} style={{ ...card, borderColor: c.warn && c.value > 0 ? "#b45309" : "#2e3d63" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.warn && c.value > 0 ? "#fbbf24" : "#e6e9f0" }}>{c.value}</div>
            <div style={{ fontSize: 12.5, color: "#8b96ac" }}>{c.label}</div>
          </a>
        ))}
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const { data, error } = useList<Summary>("/dashboard/summary");
  const vendorQueue = useList<unknown>("/reviews/findings");
  const vendorPending = Array.isArray(vendorQueue.data) ? vendorQueue.data.length : ((vendorQueue.data as { findings?: unknown[] } | null)?.findings?.length ?? 0);
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", color: "#e6e9f0" }}>
      <h1 style={{ fontSize: 24, margin: "0 0 4px 0" }}>Dashboard</h1>
      <p style={{ ...muted, marginTop: 0 }}>AI governance posture and what needs attention. Numbers summarize existing records - open each one to act in its authoritative workflow.</p>
      {error && <p style={{ ...muted, color: "#fca5a5" }}>{error}</p>}
      {!error && !data && <p style={muted}>Loading...</p>}
      {data && (
        <>
          <Section
            title="Needs attention"
            cards={[
              { label: "Pending reviews for you", value: data.attention.pendingReviewsForMe + vendorPending, href: "/reviews/pending", warn: true },
              { label: "My work items", value: data.attention.myWork, href: "/my-work" },
              { label: "Open Findings", value: data.attention.findingsOpen, href: "/findings", warn: true },
              { label: "Critical/high open Findings", value: data.attention.criticalOrHighOpenFindings, href: "/findings", warn: true },
              { label: "Findings awaiting review", value: data.attention.findingsPendingReview, href: "/findings" },
              { label: "Overdue AI remediation", value: data.attention.aiRemediationOverdue, href: "/remediation", warn: true },
              { label: "Remediation awaiting verification", value: data.attention.remediationAwaitingVerification, href: "/remediation" },
              { label: "Monitoring checks overdue", value: data.attention.monitoringOverdue, href: "/governance-monitoring", warn: true },
              { label: "Monitoring checks due soon", value: data.attention.monitoringDueSoon, href: "/governance-monitoring" },
              { label: "Reassessments past target", value: data.attention.reassessmentsPastTarget, href: "/reassessments", warn: true },
              { label: `Risk Acceptance expiring (${data.acceptanceExpiringDays}d)`, value: data.attention.riskAcceptanceExpiringSoon, href: "/risk-acceptance", warn: true },
              { label: "Risk Acceptance expired", value: data.attention.riskAcceptanceExpired, href: "/risk-acceptance", warn: true },
              { label: "Risk Acceptance decisions pending", value: data.attention.riskAcceptancePending, href: "/risk-acceptance" },
            ]}
          />
          <Section
            title="AI governance posture"
            cards={[
              { label: "AI systems", value: data.posture.aiSystems, href: "/ai-inventory" },
              { label: "In production", value: data.posture.inProduction, href: "/ai-inventory" },
              { label: "No completed risk assessment", value: data.posture.withoutCompletedRiskAssessment, href: "/risk-assessments", warn: true },
              { label: "No completed impact assessment", value: data.posture.withoutCompletedImpactAssessment, href: "/impact-assessments", warn: true },
              { label: "Critical residual risks (latest assessed)", value: data.posture.latestAssessedResidualRisk.CRITICAL ?? 0, href: "/risk-register", warn: true },
              { label: "High residual risks (latest assessed)", value: data.posture.latestAssessedResidualRisk.HIGH ?? 0, href: "/risk-register", warn: true },
              { label: "Moderate residual risks", value: data.posture.latestAssessedResidualRisk.MODERATE ?? 0, href: "/risk-register" },
              { label: "Low residual risks", value: data.posture.latestAssessedResidualRisk.LOW ?? 0, href: "/risk-register" },
              { label: "Open AI remediation", value: data.posture.aiRemediationOpen, href: "/remediation" },
              { label: "Active Risk Acceptances", value: data.posture.riskAcceptanceActive, href: "/risk-acceptance" },
              { label: "Active monitoring checks", value: data.posture.monitoringChecksActive, href: "/governance-monitoring" },
              { label: "Reassessments in progress", value: data.posture.reassessmentsInProgress, href: "/reassessments" },
            ]}
          />
          {data.thirdParty && (
            <Section
              title="Third-Party AI Risk"
              cards={[
                { label: "Vendors", value: data.thirdParty.vendors, href: "/vendors-list" },
                { label: "Vendors with AI functionality", value: data.thirdParty.aiVendors, href: "/vendors-list" },
                { label: "Open vendor remediation", value: data.thirdParty.openVendorRemediation, href: "/remediation" },
                { label: "Vendor finding reviews for you", value: vendorPending, href: "/governance/reviews" },
              ]}
            />
          )}
        </>
      )}
    </main>
  );
}