"use client";
import Link from "next/link";
import { useState } from "react";

type Action = { label: string; href: string };

type Step = {
  number: number;
  title: string;
  concept: string;
  example: string;
  analystJob: string;
  actions: Action[];
  notAvailableNote?: string;
};

const steps: Step[] = [
  {
    number: 1,
    title: "Vendor Intake",
    concept: "Who is the vendor, what service is the business buying, and why does the business actually need them?",
    example: "A bank's marketing team wants to use a new email campaign vendor that will store customer email addresses and campaign engagement data.",
    analystJob: "Register the vendor and document the service being purchased and the business justification for it.",
    actions: [{ label: "Register a vendor", href: "/vendors-list" }],
  },
  {
    number: 2,
    title: "Criticality & Tiering",
    concept: "How important is this vendor, and what would happen to the business if the vendor failed or was compromised?",
    example: "A payroll processor is Critical - if it fails, employees don't get paid. A conference-registration vendor is Low - inconvenient, but not existential.",
    analystJob: "Classify the vendor as Low, Medium, High, or Critical based on the real business impact of disruption.",
    actions: [{ label: "Set vendor criticality", href: "/vendors-list" }],
  },
  {
    number: 3,
    title: "Inherent Risk",
    concept: "How much risk exists in this relationship before considering the vendor's own security or compliance controls.",
    example: "A cloud AI vendor that processes customer financial information and has access to production systems can carry high inherent risk even if it ultimately has excellent controls - the exposure itself is the starting point.",
    analystJob: "Evaluate data sensitivity, system access, business dependency, AI use, and regulatory exposure to establish the baseline risk.",
    actions: [{ label: "Open the assessment", href: "/assessments" }],
  },
  {
    number: 4,
    title: "Due Diligence / Assessment",
    concept: "Now investigate whether the vendor actually manages the risks identified in step 3 - don't assume, verify.",
    example: "The vendor is sent a structured questionnaire covering access control, encryption, incident response, and subcontractor use.",
    analystJob: "Start the assessment and answer or review the questionnaire with the vendor.",
    actions: [{ label: "Go to Assessment Workspace", href: "/assessments" }],
  },
  {
    number: 5,
    title: "Controls & Frameworks",
    concept: "Which specific requirements actually apply to this vendor, based on what they do and what data they touch.",
    example: "A vendor handling protected health information pulls in HIPAA-relevant controls; a vendor processing card payments pulls in different ones entirely.",
    analystJob: "Map the vendor to the applicable controls and frameworks rather than assuming one generic checklist fits every vendor.",
    actions: [{ label: "Go to Framework Explorer", href: "/frameworks" }],
  },
  {
    number: 6,
    title: "Evidence Review",
    concept: "Don't just trust the vendor's answer to a questionnaire - verify it against real, independent documentation.",
    example: "A vendor claims to encrypt data at rest. Their SOC 2 report is reviewed to confirm the control is actually implemented and was tested by an independent auditor, not just claimed in an email.",
    analystJob: "Review SOC 2 reports, policies, certifications, screenshots, and test results submitted as evidence.",
    actions: [{ label: "Go to Evidence Library", href: "/evidence" }],
  },
  {
    number: 7,
    title: "Findings & Residual Risk",
    concept: "After controls and evidence are considered, what risk actually remains? That remaining risk is captured as findings.",
    example: "A vendor's evidence confirms encryption is in place, but there is no evidence of a tested incident response plan - that gap becomes a documented finding.",
    analystJob: "Create findings for genuine gaps and determine the residual risk that's left once real controls and evidence are accounted for.",
    actions: [{ label: "Go to Assessment Workspace", href: "/assessments" }],
  },
  {
    number: 8,
    title: "Human Risk Decision",
    concept: "An authorized person - never an AI system - makes the actual decision about what a finding means and what happens next.",
    example: "The AI Assistant proposes that a finding looks like a low-severity gap, but a human reviewer examines the same evidence and decides whether to accept, override, or escalate that assessment.",
    analystJob: "Review the finding as an authorized Reviewer or Administrator before any decision becomes final.",
    actions: [{ label: "Go to Pending Reviews", href: "/governance/reviews" }],
  },
  {
    number: 9,
    title: "Risk Treatment",
    concept: "Once a finding and its residual risk are confirmed, someone has to decide what to actually do about it. This isn't one path - it branches into a real decision: remediate the gap, formally accept the risk, or avoid/transfer it entirely.",
    example: "A vendor lacks multi-factor authentication on admin accounts. The organization could require the vendor to fix it (remediate), decide the exposure is low enough to knowingly accept (accept), or decide the relationship isn't worth the risk at all (avoid).",
    analystJob: "Track which treatment path was chosen and make sure it's actually followed through, not just decided and forgotten.",
    actions: [
      { label: "Track a remediation", href: "/remediation" },
      { label: "Submit a risk acceptance", href: "/vendors-list" },
    ],
    notAvailableNote: "Avoiding or transferring a risk (declining the vendor relationship, or shifting risk via insurance or contract terms) isn't a distinct tracked feature in this version - it's a real decision an analyst makes, just not yet captured as its own workflow step here.",
  },
  {
    number: 10,
    title: "Approval & Onboarding Decision",
    concept: "Can the organization actually proceed with this vendor, under the conditions identified - approved, conditionally approved, or rejected?",
    example: "After a finding is remediated and confirmed, the vendor relationship is formally approved to move forward under normal terms.",
    analystJob: "Confirm the vendor is cleared to proceed once its risk treatment (step 9) is genuinely resolved, not just started.",
    actions: [],
    notAvailableNote: "In this version, this decision isn't a separate tracked step - it's effectively folded into the risk acceptance and review decisions in steps 8 and 9. A standalone approval/onboarding record is a reasonable future addition.",
  },
  {
    number: 11,
    title: "Ongoing Monitoring & Reassessment",
    concept: "TPRM doesn't stop the moment a vendor is approved. Risk changes over time, so the relationship has to be periodically re-checked.",
    example: "A vendor is scheduled for annual reassessment, but a mid-year data breach disclosure triggers an unscheduled, off-cycle review instead of waiting for the calendar date.",
    analystJob: "Track reassessment schedules and recognize the events - incidents, material changes, contract renewal - that should trigger a new assessment early.",
    actions: [],
    notAvailableNote: "Scheduled reassessment and monitoring triggers aren't built in this version. This stage is included so the full lifecycle is understood, even though there's nothing to practice here yet.",
  },
  {
    number: 12,
    title: "Offboarding / Termination",
    concept: "Vendor risk has to be actively managed when a relationship ends, not just when it begins - access and data don't disappear on their own.",
    example: "A vendor contract ends. Before the relationship is closed out, the organization confirms the vendor's system access was revoked and obtains written confirmation that customer data was returned or securely destroyed.",
    analystJob: "Record termination, confirm access removal, and collect closure evidence such as a certificate of data destruction.",
    actions: [],
    notAvailableNote: "Offboarding isn't built in this version. This stage is included so the full vendor lifecycle is understood end to end, even though there's nothing to practice here yet.",
  },
];

export default function TPRMGuidePage() {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const activeStep = steps.find((s) => s.number === selectedStep);

  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>TPRM Workflow Guide</h1>
      <p style={{ color: "#8b96ac", fontSize: 13.5, marginBottom: 8, lineHeight: 1.6 }}>
        Third-Party Risk Management (TPRM) is the real-world discipline VendorGuard AI is
        built around. This guide walks through the full vendor lifecycle - not just where to
        click, but what each stage means, what a TPRM analyst is actually deciding at each
        point, and how that maps to a real example.
      </p>
      <p style={{ color: "#8b96ac", fontSize: 12.5, marginBottom: 28, lineHeight: 1.6, fontStyle: "italic" }}>
        For a quick tour of the app itself, see the GRC Workflow Guide. This guide goes
        deeper into the TPRM concepts behind each step.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: 12,
          overflowX: "auto",
          paddingBottom: 4,
        }}
      >
        {steps.map((step, i) => (
          <div key={step.number} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setSelectedStep(step.number)}
              title={step.title}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                background: selectedStep === step.number ? "#a78bfa" : "#1a2340",
                border: "1px solid #a78bfa",
                color: selectedStep === step.number ? "#1a2340" : "#a78bfa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10.5,
                fontWeight: 700,
                flexShrink: 0,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {step.number}
            </button>
            {i < steps.length - 1 && (
              <div style={{ width: 12, height: 1, background: "#2e3d63", flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>

      {activeStep && (
        <div
          style={{
            background: "#1a2340",
            border: "1px solid #a78bfa",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 20,
            fontSize: 12.5,
            color: "#c4b5fd",
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: "#a78bfa" }}>
            {activeStep.number}. {activeStep.title}:
          </strong>{" "}
          {activeStep.concept}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: activeStep ? 0 : 20 }}>
        {steps.map((step) => (
          <div
            key={step.number}
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "20px 22px",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: "rgba(167,139,250,0.14)",
                  color: "#a78bfa",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: 2,
                }}
              >
                {step.number}
              </div>
              <div style={{ fontWeight: 600, fontSize: 15.5 }}>{step.title}</div>
            </div>

            <div style={{ color: "#c7cee2", fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
              {step.concept}
            </div>

            <div
              style={{
                background: "#151c33",
                border: "1px solid #2e3d63",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 10,
                fontSize: 12.5,
                color: "#8b96ac",
                lineHeight: 1.55,
              }}
            >
              <strong style={{ color: "#c7cee2" }}>Example: </strong>
              {step.example}
            </div>

            <div style={{ fontSize: 12.5, color: "#8b96ac", lineHeight: 1.6, marginBottom: 14 }}>
              <strong style={{ color: "#c7cee2" }}>What a TPRM analyst does: </strong>
              {step.analystJob}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {step.actions.map((action) => (
                <Link
                  key={action.href + action.label}
                  href={action.href}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#3b82f6",
                    border: "1px solid #3b82f6",
                    borderRadius: 8,
                    padding: "8px 14px",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {action.label}
                </Link>
              ))}
              {step.actions.length === 0 && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#8b96ac",
                    border: "1px solid #2e3d63",
                    borderRadius: 8,
                    padding: "7px 12px",
                  }}
                >
                  Not yet available in this version
                </span>
              )}
            </div>

            {step.notAvailableNote && (
              <div style={{ fontSize: 11.5, color: "#5d6786", lineHeight: 1.5, marginTop: 10, fontStyle: "italic" }}>
                {step.notAvailableNote}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}