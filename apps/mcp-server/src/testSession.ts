// Test fixture only: create the durable session production authentication requires.
import { randomUUID } from "node:crypto";
import {
  Prisma,
  issueStoredSession,
  SESSION_MAX_AGE_MS,
} from "@vendorguard/database";
import { createSessionCookie, type SessionCookie } from "@vendorguard/auth";

export async function issueTestSessionCookie(
  identity: SessionCookie,
): Promise<string> {
  const issuedAt = Date.now();
  let lifetime;
  try {
    // The membership FK is authoritative; avoid a redundant fixture lookup.
    lifetime = await issueStoredSession(identity.userId, identity.tenantId);
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2003"
    )
      throw error;
    // Negative authentication probes intentionally use absent memberships.
    lifetime = {
      sessionId: randomUUID(),
      issuedAt,
      expiresAt: issuedAt + SESSION_MAX_AGE_MS,
    };
  }
  return createSessionCookie({ ...identity, ...lifetime });
}
