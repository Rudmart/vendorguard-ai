import { prisma } from "@vendorguard/database";

/**
 * Phase D1 - AI System assessment posture, DERIVED ON READ.
 * Source of truth = the authoritative Risk + Impact Assessment versions and open reassessments.
 * The legacy AiSystem.assessmentStatus column is NOT read or written here (it is preserved untouched).
 *
 * NOT_ASSESSED        - no COMPLETED risk assessment AND no COMPLETED impact assessment
 * ASSESSMENT_REQUIRED - exactly one of risk/impact has a COMPLETED version, OR a reassessment is IN_PROGRESS
 * ASSESSED            - both have a COMPLETED version AND no reassessment is IN_PROGRESS
 * A newer draft never downgrades the latest completed (assessed) posture.
 */
export type PostureState = "NOT_ASSESSED" | "ASSESSMENT_REQUIRED" | "ASSESSED";

export type AssessmentVersionRow = { id: string; version: number; status: string; completedAt: Date | null };

export type AssessmentPosture = {
  state: PostureState;
  latestRisk: AssessmentVersionRow | null;
  latestImpact: AssessmentVersionRow | null;
  riskInProgress: AssessmentVersionRow | null;
  impactInProgress: AssessmentVersionRow | null;
  reassessmentInProgress: { id: string } | null;
};

function summarize(rows: AssessmentVersionRow[]) {
  const sorted = [...rows].sort((a, b) => b.version - a.version);
  const latest = sorted[0] ?? null;
  const latestCompleted = sorted.find((r) => r.status === "COMPLETED") ?? null;
  const inProgress = latest && latest.status !== "COMPLETED" ? latest : null;
  return { latestCompleted, inProgress };
}

export function deriveAssessmentPosture(
  riskRows: AssessmentVersionRow[],
  impactRows: AssessmentVersionRow[],
  reassessmentInProgress: { id: string } | null,
): AssessmentPosture {
  const risk = summarize(riskRows);
  const impact = summarize(impactRows);
  let state: PostureState;
  if (!risk.latestCompleted && !impact.latestCompleted) {
    state = "NOT_ASSESSED";
  } else if (risk.latestCompleted && impact.latestCompleted && !reassessmentInProgress) {
    state = "ASSESSED";
  } else {
    state = "ASSESSMENT_REQUIRED";
  }
  return {
    state,
    latestRisk: risk.latestCompleted,
    latestImpact: impact.latestCompleted,
    riskInProgress: risk.inProgress,
    impactInProgress: impact.inProgress,
    reassessmentInProgress,
  };
}

/** Read-only loader. Call only after the AI system's tenant ownership has been verified. */
export async function loadAssessmentPosture(aiSystemId: string): Promise<AssessmentPosture> {
  const select = { id: true, version: true, status: true, completedAt: true } as const;
  const [risk, impact, reassessment] = await Promise.all([
    prisma.aiRiskAssessment.findMany({ where: { aiSystemId }, select }),
    prisma.aiImpactAssessment.findMany({ where: { aiSystemId }, select }),
    prisma.aiReassessment.findFirst({ where: { aiSystemId, status: "IN_PROGRESS" }, select: { id: true } }),
  ]);
  return deriveAssessmentPosture(risk, impact, reassessment);
}