import { randomUUID } from "node:crypto";
import { prisma } from "@vendorguard/database";
import { getSessionFromCookie, requestContextSchema, type RequestContext } from "@vendorguard/auth";

export async function resolveMcpContext(cookieValue: string | undefined): Promise<RequestContext> {
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

export async function logToolCall(
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