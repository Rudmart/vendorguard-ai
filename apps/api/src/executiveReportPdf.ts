/**
 * apps/api/src/executiveReportPdf.ts
 *
 * Renders the data from buildExecutiveReport() into a real PDF, using
 * pdfkit (pure JS, no native binaries). This is a functional first version -
 * real data, clear sections, readable layout - not a pixel-perfect match
 * of the earlier design mockups, which used a different tool (reportlab)
 * entirely outside this codebase.
 */

import PDFDocument from "pdfkit";
import type { buildExecutiveReport } from "./executiveReport.js";

type ExecutiveReportData = NonNullable<Awaited<ReturnType<typeof buildExecutiveReport>>>;

const COLORS = {
  navy: "#1a2340",
  red: "#dc2626",
  orange: "#ea580c",
  green: "#16a34a",
  grey: "#6b7280",
  black: "#111111",
};

function severityColor(severity: string): string {
  if (severity === "CRITICAL") return COLORS.red;
  if (severity === "HIGH") return COLORS.orange;
  return COLORS.grey;
}

export async function renderExecutiveReportPdf(report: ExecutiveReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    const chunks: Buffer[] = [];
    const stream = doc as unknown as NodeJS.ReadableStream;
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);

    doc.fillColor(COLORS.red).fontSize(8).font("Helvetica-Bold")
      .text("CONFIDENTIAL - INTERNAL USE ONLY", { align: "center" });
    doc.moveDown(0.5);

    doc.fillColor(COLORS.navy).fontSize(20).font("Helvetica-Bold")
      .text("Executive Risk Report");
    doc.fillColor(COLORS.grey).fontSize(10).font("Helvetica")
      .text(`${report.vendor.legalName}  |  Generated ${new Date().toLocaleDateString()}`);
    doc.moveDown(1);

    if (report.riskRating) {
      doc.fillColor(COLORS.navy).fontSize(13).font("Helvetica-Bold").text("Overall Risk Rating");
      doc.fillColor(severityColor(report.riskRating.finalRating)).fontSize(24).font("Helvetica-Bold")
        .text(report.riskRating.finalRating);
      doc.fillColor(COLORS.black).fontSize(10).font("Helvetica").text(
        `Inherent: ${report.riskRating.inherentScore}   Control Effectiveness: ${report.riskRating.controlEffectiveness}%   Residual: ${report.riskRating.residualScore}`
      );
      if (report.previousRiskRating) {
        doc.fillColor(COLORS.grey).fontSize(9).text(
          `Previous cycle - Rating: ${report.previousRiskRating.finalRating}, Inherent: ${report.previousRiskRating.inherentScore}, Residual: ${report.previousRiskRating.residualScore}`
        );
      }
    } else {
      doc.fillColor(COLORS.grey).fontSize(11).font("Helvetica-Oblique")
        .text("No risk rating has been recorded for this vendor yet.");
    }
    doc.moveDown(1);

    doc.fillColor(COLORS.navy).fontSize(13).font("Helvetica-Bold").text("Findings Summary");
    doc.fillColor(COLORS.black).fontSize(10).font("Helvetica").text(
      `Total: ${report.findings.total}   Open: ${report.findings.openCount}   Closed: ${report.findings.closedCount}   Reviewed (of open): ${report.findings.reviewedOpenCount} of ${report.findings.openCount}`
    );
    doc.moveDown(0.5);

    if (report.findings.highCriticalOpen.length > 0) {
      doc.fillColor(COLORS.navy).fontSize(12).font("Helvetica-Bold").text("High and Critical Findings (Open)");
      doc.moveDown(0.3);
      for (const f of report.findings.highCriticalOpen) {
        doc.fillColor(severityColor(f.severity)).fontSize(9).font("Helvetica-Bold")
          .text(`${f.severity}  ${f.controlId} - ${f.controlTitle}`, { continued: false });
        doc.fillColor(COLORS.black).fontSize(9).font("Helvetica")
          .text(`Impact: ${f.impactType}   Reviewed: ${f.reviewed ? "Yes" : "No"}`);
        if (f.gaps.length > 0) {
          doc.fillColor(COLORS.grey).fontSize(8).text(`Gap: ${f.gaps[0]}`);
        }
        doc.moveDown(0.4);
      }
    } else {
      doc.fillColor(COLORS.grey).fontSize(10).font("Helvetica-Oblique")
        .text("No open High or Critical findings.");
    }
    doc.moveDown(1);

    doc.fillColor(COLORS.navy).fontSize(13).font("Helvetica-Bold").text("Remediation Status");
    const rc = report.remediation.counts;
    doc.fillColor(COLORS.black).fontSize(10).font("Helvetica").text(
      `Open: ${rc.open}   In Progress: ${rc.inProgress}   Overdue: ${rc.overdue}   Closed: ${rc.closed}   Total: ${rc.total}`
    );
    if (report.remediation.overdueItems.length > 0) {
      doc.moveDown(0.3);
      doc.fillColor(COLORS.red).fontSize(9).font("Helvetica-Bold").text("Overdue Items:");
      for (const item of report.remediation.overdueItems) {
        doc.fillColor(COLORS.black).fontSize(9).font("Helvetica")
          .text(`- ${item.title} (${item.linkedFindingControlId ?? "unlinked"}, ${item.linkedFindingSeverity ?? "n/a"})`);
      }
    }
    doc.moveDown(1);

    doc.fillColor(COLORS.navy).fontSize(13).font("Helvetica-Bold").text("Framework and Control Coverage");
    for (const fw of report.frameworkCoverage) {
      doc.fillColor(COLORS.black).fontSize(9).font("Helvetica").text(
        `${fw.framework}: ${fw.assessed} of ${fw.applicable} assessed (${fw.coveragePercent}%)`
      );
    }
    doc.moveDown(1);

    doc.fillColor(COLORS.navy).fontSize(13).font("Helvetica-Bold").text("Evidence Status");
    const ev = report.evidenceStatus;
    doc.fillColor(COLORS.black).fontSize(10).font("Helvetica").text(
      `Total: ${ev.total}   Current: ${ev.current}   Expiring Soon: ${ev.expiringSoon}   Expired: ${ev.expired}`
    );
    doc.moveDown(1);

    doc.fillColor(COLORS.grey).fontSize(8).font("Helvetica-Oblique").text(
      "All data above is sourced directly from VendorGuard's database, not AI-generated. This export event is logged to the audit trail.",
      { align: "left" }
    );

    doc.end();
  });
}