/**
 * Shared session-cookie helpers. This is the single place both apps/api
 * and apps/mcp-server read the dev-mode session cookie from, so there is
 * exactly one definition of "who is making this request" - never two
 * copies that could silently drift apart. See tenant-context.ts for the
 * longer-term production plan (verified Entra ID JWT claims); this cookie
 * is today's real, working mechanism, not a placeholder.
 */

export const COOKIE_NAME = "vg_session";

export interface SessionCookie {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: string;
}

export function getSessionFromCookie(cookieValue: string | undefined): SessionCookie | null {
  if (!cookieValue) return null;
  try {
    return JSON.parse(cookieValue) as SessionCookie;
  } catch {
    return null;
  }
}