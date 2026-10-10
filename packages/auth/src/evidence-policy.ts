import { roleHasPermission, type Role } from "@vendorguard/shared";

export type EvidenceOperation = "metadata" | "content" | "analysis";
export function evidenceAllowed(
  role: Role,
  operation: EvidenceOperation,
): boolean {
  return (
    roleHasPermission(role, "evidence:read") ||
    (operation === "metadata" &&
      roleHasPermission(role, "evidence:read-metadata"))
  );
}

/** Context is loaded by the server from the specific pending governance record.
 * This never grants browsing, content/download, or analysis authority.
 */
export function independentEvidenceContext(
  actor: { userId: string; role: Role },
  link: {
    status: string;
    submittedByUserId: string;
    evidenceDocument: { uploadedByUserId: string };
  },
): boolean {
  return (
    roleHasPermission(actor.role, "ai-control-evidence:review") &&
    link.status === "PENDING_REVIEW" &&
    link.submittedByUserId !== actor.userId &&
    link.evidenceDocument.uploadedByUserId !== actor.userId
  );
}

/** Metadata for the assigned independent tester of this specific control test. */
export function independentControlTestEvidenceContext(
  actor: { userId: string; role: Role },
  test: {
    testerUserId: string;
    aiSystemControl: { ownerUserId: string | null };
  },
  link: {
    submittedByUserId: string;
    evidenceDocument: { uploadedByUserId: string };
  },
): boolean {
  return (
    roleHasPermission(actor.role, "ai-control-test:perform") &&
    test.testerUserId === actor.userId &&
    test.aiSystemControl.ownerUserId !== actor.userId &&
    link.submittedByUserId !== actor.userId &&
    link.evidenceDocument.uploadedByUserId !== actor.userId
  );
}
