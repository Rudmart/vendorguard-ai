import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "@vendorguard/database";
import { getSessionFromCookie, COOKIE_NAME, requestContextSchema, type RequestContext } from "@vendorguard/auth";
import { listFrameworks, listControls, getControl, searchControls } from "./frameworks-data.js";
import { analyzeEvidence, detectPromptInjection } from "@vendorguard/ai-client";

// Explicit tool allowlist (spec §16). Even though the handler below only
// recognizes these exact names anyway, this makes the allowlist a named,
// checkable thing rather than an implicit side effect of an if-chain -
// any tool call outside this set is denied and audited before any other
// logic runs.
const ALLOWED_TOOLS = new Set([
  "get_vendor", "get_framework", "search_controls", "get_risk", "get_assessment",
  "get_findings", "get_remediation", "get_control", "map_controls",
  "get_evidence", "evaluate_evidence", "generate_report",
]);

const server = Fastify({ logger: true });

server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  credentials: true,
});
server.register(cookie);

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-mcp-server" };
});

import { resolveMcpContext, logToolCall } from "./context.js";

function buildServerForContext(context: RequestContext) {
  const mcp = new Server(
    { name: "vendorguard-mcp-server", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "get_vendor",
          description: "Get full details on one vendor, scoped to the caller's tenant.",
          inputSchema: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "The vendor's ID" },
            },
            required: ["vendorId"],
          },
        },
        {
          name: "get_framework",
          description: "List all compliance/regulatory frameworks available, with how many controls each has.",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "search_controls",
          description: "Search for controls matching a text query across all frameworks.",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Search text" } },
            required: ["query"],
          },
        },
        {
          name: "get_risk",
          description: "Get the current risk scores (inherent, residual, band, control effectiveness) for a vendor's most recent assessment.",
          inputSchema: {
            type: "object",
            properties: { vendorId: { type: "string", description: "The vendor's ID" } },
            required: ["vendorId"],
          },
        },
        {
          name: "get_assessment",
          description: "Get full details on one assessment, scoped to the caller's tenant.",
          inputSchema: {
            type: "object",
            properties: { assessmentId: { type: "string", description: "The assessment's ID" } },
            required: ["assessmentId"],
          },
        },
        {
          name: "get_findings",
          description: "Get all findings for a given assessment, scoped to the caller's tenant.",
          inputSchema: {
            type: "object",
            properties: { assessmentId: { type: "string", description: "The assessment's ID" } },
            required: ["assessmentId"],
          },
        },
        {
          name: "get_remediation",
          description: "Get all remediation actions for a given finding, scoped to the caller's tenant.",
          inputSchema: {
            type: "object",
            properties: { findingId: { type: "string", description: "The finding's ID" } },
            required: ["findingId"],
          },
        },
        {
          name: "get_control",
          description: "Get full details on one control from the real control library.",
          inputSchema: {
            type: "object",
            properties: { controlId: { type: "string", description: "The control's database ID" } },
            required: ["controlId"],
          },
        },
        {
          name: "map_controls",
          description: "Get all cross-framework mappings for a given control (which other controls it satisfies or relates to).",
          inputSchema: {
            type: "object",
            properties: { controlId: { type: "string", description: "The control's database ID" } },
            required: ["controlId"],
          },
        },
        {
          name: "get_evidence",
          description: "List evidence documents for a vendor, scoped to the caller's tenant.",
          inputSchema: {
            type: "object",
            properties: { vendorId: { type: "string", description: "The vendor's ID" } },
            required: ["vendorId"],
          },
        },
        {
          name: "evaluate_evidence",
          description: "Run AI analysis on one evidence document against candidate controls. This is analysis only - it never marks a control compliant or closes a finding; human review is always required.",
          inputSchema: {
            type: "object",
            properties: { evidenceDocumentId: { type: "string", description: "The evidence document's ID" } },
            required: ["evidenceDocumentId"],
          },
        },
        {
          name: "generate_report",
          description: "Generate a structured executive risk summary for a vendor - risk scores, findings by status, remediation status, evidence count. Uses only authoritative VendorGuard data, never AI-generated facts.",
          inputSchema: {
            type: "object",
            properties: { vendorId: { type: "string", description: "The vendor's ID" } },
            required: ["vendorId"],
          },
        },
      ],
    };
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!ALLOWED_TOOLS.has(name)) {
      await logToolCall(context, name, "DENIED", { reason: "tool not in allowlist" });
      return { content: [{ type: "text", text: "This tool is not permitted." }], isError: true };
    }

    try {
      if (name === "get_vendor") {
        const vendorId = String(args?.vendorId ?? "");
        const vendor = await prisma.vendor.findFirst({
          where: { id: vendorId, tenantId: context.tenantId },
        });
        await logToolCall(context, name, vendor ? "SUCCESS" : "DENIED", { vendorId });
        if (!vendor) {
          return { content: [{ type: "text", text: "Vendor not found." }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(vendor, null, 2) }] };
      }

      if (name === "get_framework") {
        await logToolCall(context, name, "SUCCESS");
        return { content: [{ type: "text", text: JSON.stringify(listFrameworks(), null, 2) }] };
      }

      if (name === "search_controls") {
        const query = String(args?.query ?? "");
        await logToolCall(context, name, "SUCCESS", { query });
        return { content: [{ type: "text", text: JSON.stringify(searchControls(query), null, 2) }] };
      }

      if (name === "get_risk") {
        const vendorId = String(args?.vendorId ?? "");
        const assessment = await prisma.assessment.findFirst({
          where: { vendorId, tenantId: context.tenantId },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            inherentScore: true,
            residualScore: true,
            riskBand: true,
            controlEffectiveness: true,
            aiInherentScore: true,
            aiResidualScore: true,
            aiRiskBand: true,
            aiControlEffectiveness: true,
          },
        });
        await logToolCall(context, name, assessment ? "SUCCESS" : "DENIED", { vendorId });
        if (!assessment) {
          return { content: [{ type: "text", text: "No assessment found for this vendor." }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(assessment, null, 2) }] };
      }

      if (name === "get_assessment") {
        const assessmentId = String(args?.assessmentId ?? "");
        const assessment = await prisma.assessment.findFirst({
          where: { id: assessmentId, tenantId: context.tenantId },
        });
        await logToolCall(context, name, assessment ? "SUCCESS" : "DENIED", { assessmentId });
        if (!assessment) {
          return { content: [{ type: "text", text: "Assessment not found." }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(assessment, null, 2) }] };
      }

      if (name === "get_findings") {
        const assessmentId = String(args?.assessmentId ?? "");
        // Confirm the assessment itself belongs to this tenant before
        // returning any findings under it - never trust assessmentId alone.
        const assessment = await prisma.assessment.findFirst({
          where: { id: assessmentId, tenantId: context.tenantId },
        });
        if (!assessment) {
          await logToolCall(context, name, "DENIED", { assessmentId });
          return { content: [{ type: "text", text: "Assessment not found." }], isError: true };
        }
        const findings = await prisma.controlFinding.findMany({
          where: { assessmentId, tenantId: context.tenantId },
        });
        await logToolCall(context, name, "SUCCESS", { assessmentId, count: findings.length });
        return { content: [{ type: "text", text: JSON.stringify(findings, null, 2) }] };
      }

      if (name === "get_remediation") {
        const findingId = String(args?.findingId ?? "");
        const remediations = await prisma.remediationAction.findMany({
          where: { findingId, tenantId: context.tenantId },
        });
        await logToolCall(context, name, "SUCCESS", { findingId, count: remediations.length });
        return { content: [{ type: "text", text: JSON.stringify(remediations, null, 2) }] };
      }

      if (name === "get_control") {
        // Controls are global reference data (frameworks apply to every
        // tenant identically), so no tenant scoping is needed here - same
        // as get_framework and search_controls.
        const controlId = String(args?.controlId ?? "");
        const control = await prisma.control.findUnique({ where: { id: controlId } });
        await logToolCall(context, name, control ? "SUCCESS" : "DENIED", { controlId });
        if (!control) {
          return { content: [{ type: "text", text: "Control not found." }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(control, null, 2) }] };
      }

      if (name === "map_controls") {
        const controlId = String(args?.controlId ?? "");
        const mappings = await prisma.controlMapping.findMany({
          where: { OR: [{ fromControlId: controlId }, { toControlId: controlId }] },
          include: { fromControl: true, toControl: true },
        });
        await logToolCall(context, name, "SUCCESS", { controlId, count: mappings.length });
        return { content: [{ type: "text", text: JSON.stringify(mappings, null, 2) }] };
      }

      if (name === "get_evidence") {
        const vendorId = String(args?.vendorId ?? "");
        const documents = await prisma.evidenceDocument.findMany({
          where: { vendorId, tenantId: context.tenantId, deletedAt: null },
          select: {
            id: true,
            displayFilename: true,
            mimeType: true,
            sizeBytes: true,
            documentType: true,
            state: true,
            expirationDate: true,
            version: true,
          },
        });
        await logToolCall(context, name, "SUCCESS", { vendorId, count: documents.length });
        return { content: [{ type: "text", text: JSON.stringify(documents, null, 2) }] };
      }

      if (name === "evaluate_evidence") {
        const evidenceDocumentId = String(args?.evidenceDocumentId ?? "");
        const document = await prisma.evidenceDocument.findFirst({
          where: { id: evidenceDocumentId, tenantId: context.tenantId },
          include: { chunks: { orderBy: { chunkIndex: "asc" } } },
        });
        if (!document) {
          await logToolCall(context, name, "DENIED", { evidenceDocumentId });
          return { content: [{ type: "text", text: "Evidence document not found." }], isError: true };
        }

        const candidateControls = await prisma.control.findMany({
          where: { expectedEvidenceTypes: { has: document.documentType } },
        });
        const evidenceText =
          document.chunks.length > 0
            ? document.chunks.map((c) => c.text).join("\n\n")
            : `[No extracted text available for ${document.displayFilename}.]`;

        // Evidence text is untrusted content - it came from an uploaded
        // document, not a trusted instruction source. Flag it before it
        // ever reaches the model, same detection used for the AI
        // Assistant (M10), so an attempt to plant instructions inside a
        // document is surfaced rather than silently followed.
        const promptInjectionFlagged = detectPromptInjection(evidenceText);

        const analysis = await analyzeEvidence({
          documentType: document.documentType,
          evidenceText,
          candidateControls: candidateControls.map((c) => ({
            id: c.id,
            controlId: c.controlId,
            title: c.title,
            summary: c.summary,
          })),
        });

        await logToolCall(context, name, "SUCCESS", { evidenceDocumentId, promptInjectionFlagged });
        return {
          content: [{ type: "text", text: JSON.stringify({ ...analysis, promptInjectionFlagged }, null, 2) }],
        };
      }

      if (name === "generate_report") {
        const vendorId = String(args?.vendorId ?? "");
        const vendor = await prisma.vendor.findFirst({
          where: { id: vendorId, tenantId: context.tenantId },
        });
        if (!vendor) {
          await logToolCall(context, name, "DENIED", { vendorId });
          return { content: [{ type: "text", text: "Vendor not found." }], isError: true };
        }

        const assessment = await prisma.assessment.findFirst({
          where: { vendorId, tenantId: context.tenantId },
          orderBy: { updatedAt: "desc" },
        });

        const findings = assessment
          ? await prisma.controlFinding.findMany({ where: { assessmentId: assessment.id, tenantId: context.tenantId } })
          : [];
        const findingsByStatus = findings.reduce<Record<string, number>>((acc, f) => {
          acc[f.status] = (acc[f.status] ?? 0) + 1;
          return acc;
        }, {});

        const remediations = await prisma.remediationAction.findMany({
          where: { vendorId, tenantId: context.tenantId },
        });
        const remediationByStatus = remediations.reduce<Record<string, number>>((acc, r) => {
          acc[r.status] = (acc[r.status] ?? 0) + 1;
          return acc;
        }, {});

        const evidenceCount = await prisma.evidenceDocument.count({
          where: { vendorId, tenantId: context.tenantId, deletedAt: null },
        });

        const report = {
          vendor: { id: vendor.id, legalName: vendor.legalName, criticality: vendor.criticality },
          risk: assessment
            ? {
                inherentScore: assessment.inherentScore,
                residualScore: assessment.residualScore,
                riskBand: assessment.riskBand,
                controlEffectiveness: assessment.controlEffectiveness,
              }
            : null,
          findingsByStatus,
          remediationByStatus,
          evidenceCount,
        };

        await logToolCall(context, name, "SUCCESS", { vendorId });
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      }

      await logToolCall(context, name, "ERROR", { reason: "unknown tool" });
      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      await logToolCall(context, name, "ERROR", { error: String(err) });
      throw err;
    }
  });

  return mcp;
}

server.post("/mcp", async (request, reply) => {
  let context: RequestContext;
  try {
    context = await resolveMcpContext(request.cookies[COOKIE_NAME]);
  } catch {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  const mcp = buildServerForContext(context);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);

  reply.hijack();
  await transport.handleRequest(request.raw, reply.raw, request.body);
});

const PORT = Number(process.env.MCP_PORT || 4100);
server.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
  console.log(`VendorGuard MCP server running on http://0.0.0.0:${PORT}`);
});