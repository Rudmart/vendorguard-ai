/**
 * Shared session-cookie helpers - the single place both apps/api and apps/mcp-server
 * decide "who is making this request".
 *
 * Security PR 2: the cookie is now `<base64url(JSON session)>.<base64url(HMAC-SHA256)>`.
 * The signature is verified (constant-time) BEFORE any claim (userId, tenantId, role) is trusted.
 * Tampered, unsigned (legacy JSON) or malformed cookies return null -> callers answer 401.
 * There is deliberately NO fallback to unsigned JSON.
 *
 * Secret: SESSION_SECRET (min 32 chars). Required in production (throws). In development without it,
 * a random per-process secret is used - still unforgeable; sessions simply end when the API restarts.
 * Longer term: verified Entra ID tokens (see tenant-context.ts) - this is the homelab trust boundary.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "vg_session";

export interface SessionCookie {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
}

let ephemeralSecret: string | null = null;

function signingSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (at least 32 characters) is required in production");
  }
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString("hex");
  }
  return ephemeralSecret;
}

function signature(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/** Builds the signed cookie value. Only the server (holding the secret) can produce a valid one. */
export function createSessionCookie(session: SessionCookie): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${signature(payload)}`;
}

/** Verifies the signature first; returns the session only if it is authentic and well-formed. */
export function getSessionFromCookie(cookieValue: string | undefined): SessionCookie | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const payload = cookieValue.slice(0, dot);
  const given = Buffer.from(cookieValue.slice(dot + 1), "utf8");
  const expected = Buffer.from(signature(payload), "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionCookie>;
    const fields = [parsed.userId, parsed.tenantId, parsed.email, parsed.displayName, parsed.role];
    if (fields.some((v) => typeof v !== "string" || v.length === 0)) return null;
    return parsed as SessionCookie;
  } catch {
    return null;
  }
}