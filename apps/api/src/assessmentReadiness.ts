import { prisma } from "@vendorguard/database";

export async function assessmentReadiness(kind: "risk" | "impact", id: string, tenantId: string, assessor: string | null, justification: string | null) {
  if (!assessor) return "Assign an assessor before submitting for review";
  const count = kind === "risk"
    ? await prisma.aiRisk.count({ where: { assessmentId: id, tenantId } })
    : await prisma.aiImpact.count({ where: { assessmentId: id, tenantId } });
  if (!count && !justification?.trim()) return "An empty assessment requires an explicit assessor justification that no items were identified";
  return null;
}
