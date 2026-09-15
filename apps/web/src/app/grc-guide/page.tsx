"use client";
import Link from "next/link";
import { useState } from "react";

type Step = {
  number: number;
  title: string;
  description: string;
  buttonLabel: string;
  href: string;
};

const steps: Step[] = [
  {
    number: 1,
    title: "Dashboard",
    description: "See your organization's overall risk posture at a glance.",
    buttonLabel: "Go to Executive Dashboard",
    href: "/",
  },
  {
    number: 2,
    title: "Vendors",
    description: "Identify who you're doing business with and what services they provide.",
    buttonLabel: "Go to Vendor Inventory",
    href: "/vendors-list",
  },
  {
    number: 3,
    title: "Assessments",
    description: "Evaluate each vendor's risk through structured questionnaires and reviews.",
    buttonLabel: "Go to Assessment Workspace",
    href: "/assessments",
  },
  {
    number: 4,
    title: "Risk",
    description: "Review the vendor's inherent and residual risk results.",
    buttonLabel: "Go to Assessment Workspace",
    href: "/assessments",
  },
  {
    number: 5,
    title: "Controls",
    description: "Map vendors to the regulatory frameworks and controls that apply to them.",
    buttonLabel: "Go to Framework Explorer",
    href: "/frameworks",
  },
  {
    number: 6,
    title: "Evidence",
    description: "Collect and review documentation proving controls are actually in place.",
    buttonLabel: "Go to Evidence Library",
    href: "/evidence",
  },
  {
    number: 7,
    title: "Findings",
    description: "Identify and document gaps where requirements or controls are not adequately met.",
    buttonLabel: "Go to Assessment Workspace",
    href: "/assessments",
  },
  {
    number: 8,
    title: "Remediation",
    description: "Track and close the gaps that findings uncover.",
    buttonLabel: "Go to Remediation Tracker",
    href: "/remediation",
  },
  {
    number: 9,
    title: "Reports",
    description: "Reports are generated per vendor. Select a vendor to view its Executive Report.",
    buttonLabel: "Go to Vendor Inventory",
    href: "/vendors-list",
  },
];

export default function GRCGuidePage() {
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const activeStep = steps.find((s) => s.number === selectedStep);

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>GRC Workflow Guide</h1>
      <p style={{ color: "#8b96ac", fontSize: 13.5, marginBottom: 28, lineHeight: 1.6 }}>
        GRC (Governance, Risk, and Compliance) is a connected process. This guide shows
        how work moves through VendorGuard AI - from identifying vendors and assessing
        risk to reviewing evidence, managing findings, tracking remediation, and
        reporting results.
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
                width: 28,
                height: 28,
                borderRadius: 999,
                background: selectedStep === step.number ? "#a78bfa" : "#1a2340",
                border: "1px solid #a78bfa",
                color: selectedStep === step.number ? "#1a2340" : "#a78bfa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11.5,
                fontWeight: 700,
                flexShrink: 0,
                cursor: "pointer",
                padding: 0,
              }}
            >
              {step.number}
            </button>
            {i < steps.length - 1 && (
              <div style={{ width: 20, height: 1, background: "#2e3d63", flexShrink: 0 }} />
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
          {activeStep.description}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: activeStep ? 0 : 20 }}>
        {steps.map((step) => (
          <div
            key={step.number}
            style={{
              background: "#1a2340",
              border: "1px solid #2e3d63",
              borderRadius: 10,
              padding: "18px 20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: "rgba(59,130,246,0.14)",
                  color: "#3b82f6",
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
              <div>
                <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 4 }}>{step.title}</div>
                <div style={{ color: "#8b96ac", fontSize: 12.5, lineHeight: 1.5, maxWidth: 420 }}>
                  {step.description}
                </div>
              </div>
            </div>
            <Link
              href={step.href}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#3b82f6",
                border: "1px solid #3b82f6",
                borderRadius: 8,
                padding: "8px 14px",
                textDecoration: "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {step.buttonLabel}
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}