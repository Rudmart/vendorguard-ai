import { clamp, bandFor, type RiskBandName } from "./scoring.js";

/**
 * Computes a risk score for a single framework requirement (Control),
 * given its finding status and the assessment's existing contextual
 * factors. This is deliberately NOT calculateResidualRisk - that
 * function's second parameter represents risk-REDUCING control
 * effectiveness, whereas the context factors here (business criticality,
 * data sensitivity, AI autonomy, regulatory exposure) are risk-
 * INCREASING amplifiers of a gap's real-world impact, not mitigations.
 * Reuses the same clamp/bandFor primitives as every other scoring
 * function in risk-engine for consistency and auditability.
 */

export type FindingStatusInput =
  | "PASS"
  | "PARTIAL"
  | "FAIL"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "NOT_APPLICABLE";

const STATUS_SEVERITY: Record<Exclude<FindingStatusInput, "NOT_APPLICABLE">, number> = {
  FAIL: 100,
  CONFLICTING_EVIDENCE: 80,
  INSUFFICIENT_EVIDENCE: 60,
  PARTIAL: 50,
  PASS: 0,
};

export interface RequirementRiskContext {
  businessCriticality?: number | null;
  dataSensitivity?: number | null;
  decisionAutonomyLevel?: number | null;
  geographicRegulatoryExposure?: number | null;
}

export interface RequirementRiskResult {
  applicable: boolean;
  statusSeverity: number;
  contextualMultiplier: number;
  score: number;
  band: RiskBandName | null;
}

/**
 * Averages whichever contextual factors are actually present on the
 * assessment (missing factors are excluded from the average rather than
 * treated as 0, so an incomplete assessment doesn't artificially
 * understate risk).
 */
function contextualMultiplier(context: RequirementRiskContext): number {
  const values = [
    context.businessCriticality,
    context.dataSensitivity,
    context.decisionAutonomyLevel,
    context.geographicRegulatoryExposure,
  ].filter((v): v is number => typeof v === "number");

  if (values.length === 0) return 0.5; // neutral default when no context is available
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return clamp(avg, 0, 100) / 100;
}

export function calculateRequirementRisk(
  status: FindingStatusInput,
  context: RequirementRiskContext,
): RequirementRiskResult {
  if (status === "NOT_APPLICABLE") {
    return { applicable: false, statusSeverity: 0, contextualMultiplier: 0, score: 0, band: null };
  }

  const statusSeverity = STATUS_SEVERITY[status];
  const multiplier = contextualMultiplier(context);
  const rawScore = statusSeverity * multiplier;
  const score = Math.round(clamp(rawScore, 0, 100) * 100) / 100;

  return {
    applicable: true,
    statusSeverity,
    contextualMultiplier: multiplier,
    score,
    band: bandFor(score),
  };
}