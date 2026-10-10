import { prisma, type Prisma } from "./client.js";

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export async function issueStoredSession(userId: string, tenantId: string) {
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_MAX_AGE_MS);
  const row = await prisma.storedSession.create({
    data: { userId, tenantId, createdAt, expiresAt },
  });
  return {
    sessionId: row.id,
    issuedAt: createdAt.getTime(),
    expiresAt: expiresAt.getTime(),
  };
}

export async function validateStoredSession(claims: {
  sessionId?: string;
  issuedAt?: number;
  expiresAt?: number;
  userId: string;
  tenantId: string;
}): Promise<Prisma.TenantMembershipGetPayload<{
  include: { user: true };
}> | null> {
  try {
    if (!claims.sessionId || !claims.issuedAt || !claims.expiresAt) return null;
    const row = await prisma.storedSession.findUnique({
      where: { id: claims.sessionId },
      include: { membership: { include: { user: true } } },
    });
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      row.createdAt.getTime() > Date.now() ||
      row.expiresAt.getTime() - row.createdAt.getTime() > SESSION_MAX_AGE_MS ||
      row.userId !== claims.userId ||
      row.tenantId !== claims.tenantId ||
      row.createdAt.getTime() !== claims.issuedAt ||
      row.expiresAt.getTime() !== claims.expiresAt
    )
      return null;
    return row.membership;
  } catch {
    // Authentication never falls back to cookie claims when storage fails.
    return null;
  }
}

export async function revokeStoredSession(claims: {
  sessionId?: string;
  userId: string;
  tenantId: string;
}) {
  if (!claims.sessionId) return;
  await prisma.storedSession.updateMany({
    where: {
      id: claims.sessionId,
      userId: claims.userId,
      tenantId: claims.tenantId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}
