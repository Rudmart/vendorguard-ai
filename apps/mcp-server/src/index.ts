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

const server = Fastify({ logger: true });

server.register(cors, {
  origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  credentials: true,
});
server.register(cookie);

server.get("/health", async () => {
  return { status: "ok", service: "vendorguard-mcp-server" };
});

async function resolveMcpContext(cookieValue: string | undefined): Promise<RequestContext> {
  const session = getSessionFromCookie(cookieValue);
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }

  const membership = await prisma.tenantMembership.findFirst({
    where: { userId: session.userId, tenantId: session.tenantId },
  });
  if (!membership) {
    throw new Error("NO_MEMBERSHIP");
  }

  return requestContextSchema.parse({
    userId: session.userId,
    tenantId: session.tenantId,
    role: membership.role,
    correlationId: randomUUID(),
  });
}

async function logToolCall(
  context: RequestContext,
  toolName: string,
  outcome: "SUCCESS" | "DENIED" | "ERROR",
  extra?: Record<string, unknown>,
) {
  await prisma.auditEvent.create({
    data: {
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorSystem: "mcp-server",
      action: `mcp.tool_called.${toolName}`,
      targetType: "MCPTool",
      targetId: toolName,
      outcome,
      metadataJson: { correlationId: context.correlationId, ...extra },
    },
  });
}

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
      ],
    };
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

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