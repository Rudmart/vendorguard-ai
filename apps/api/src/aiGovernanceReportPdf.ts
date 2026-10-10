import PDFDocument from "pdfkit";
import type { GovernanceReport, ReportReference } from "@vendorguard/shared";
export const PDF_DETAIL_LIMIT = 200;
/** Receives only the authorized contract. No database, storage or model access. */
export function renderGovernanceReportPdf(
  report: GovernanceReport,
  records: Map<string, ReportReference[]>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 45, compress: false });
    const chunks: Buffer[] = [];
    const stream = doc as unknown as NodeJS.ReadableStream;
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    const safe = (s: string) =>
      // eslint-disable-next-line no-control-regex -- Intentionally sanitize C0 controls and DEL in PDF text.
      s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 1000);
    doc.fontSize(19).text("Executive & Governance Report");
    doc.fontSize(10).text("CONFIDENTIAL — INTERNAL USE ONLY");
    doc.text("AI ASSISTS. HUMANS GOVERN.");
    doc.text(
      "Generated UTC: " +
        report.generatedAt +
        " | Definition: " +
        report.definitionVersion,
    );
    doc.text(
      "Scope: " +
        report.scope.lifecycleScope +
        " | AI system: " +
        (report.scope.aiSystemId ?? "tenant portfolio"),
    );
    for (const limitation of report.limitations) doc.text(safe(limitation));
    let section = "";
    for (const metric of report.metrics) {
      if (section !== metric.section) {
        section = metric.section;
        doc.moveDown().fontSize(13).text(section);
      }
      doc
        .fontSize(10)
        .text(
          safe(metric.label) +
            ": " +
            (metric.access === "RESTRICTED"
              ? "RESTRICTED"
              : metric.value +
                (metric.denominator === null
                  ? ""
                  : " / " + metric.denominator) +
                " " +
                metric.unit),
        );
      doc
        .fontSize(8)
        .text(
          safe(metric.definition) + " | Lifecycle: " + metric.lifecycleScope,
        );
    }
    const unique = [
      ...new Map(
        [...records.values()].flat().map((r) => [r.type + ":" + r.id, r]),
      ).values(),
    ].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
    doc.moveDown().fontSize(13).text("Source manifest");
    doc
      .fontSize(9)
      .text(
        "Supporting records: " +
          unique.length +
          ". Appendix limit: " +
          PDF_DETAIL_LIMIT +
          ".",
      );
    if (unique.length > PDF_DETAIL_LIMIT)
      doc.text(
        "Appendix bounded: omitted sources remain available through authorized live drill-downs.",
      );
    for (const r of unique.slice(0, PDF_DETAIL_LIMIT)) {
      doc
        .fontSize(8)
        .text(
          safe(
            r.type +
              " " +
              r.id +
              " | " +
              r.title +
              " | " +
              r.status +
              (r.version ? " | version " + r.version : ""),
          ),
        );
      doc.text("Source: " + safe(r.href));
      for (const d of r.decisions)
        doc.text(
          "Human decision: " +
            safe(
              d.id +
                " | " +
                d.decision +
                " | actor " +
                (d.actorUserId ?? "unavailable") +
                " | " +
                (d.at ?? "unavailable"),
            ),
        );
    }
    doc.end();
  });
}
