import { z } from "zod";

/**
 * Deterministic vendor risk scoring engine.
 *
 * DESIGN PRINCIPLE: No LLM may invent, adjust, or override the final score.
 * An AI assistant may *suggest* individual factor inputs (e.g. "this vendor's
 * data sensitivity looks like 80 based on the questionnaire"), but every such
 * suggestion is persisted as PROPOSED and requires reviewer approval before
 * it is used as an actual scoring input (see packages/ai-client and the
 * ReviewDecision entity). This module itself never calls an AI provider.
 */

export const SCORING_MODEL_VERSION = "risk-model-2025.1" as const;

export const RISK_FACTOR_WEIGHTS = {
  dataSensitivity: 0.25,
  businessCriticality: 0.2,
  accessPrivilege: 0.15,
  operationalDependency: 0.15,
  fourthPartyConcentration: 0.15,
  geographicRegulatoryExposure: 0.1,
} as const;

export type RiskFactorKey = keyof typeof RISK_FACTOR_WEIGHTS;

// Weights must sum to 1.0. Enforced by a startup assertion + unit test so a
// future edit can't silently change the meaning of the composite score.
const WEIGHT_SUM = Object.values(RISK_FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`RISK_FACTOR_WEIGHTS must sum to 1.0, got ${WEIGHT_SUM}`);
}

export const RISK_BANDS = [
  { band: "LOW", min: 0, max: 24 },
  { band: "MODERATE", min: 25, max: 49 },
  { band: "HIGH", min: 50, max: 74 },
  { band: "CRITICAL", min: 75, max: 100 },
] as const;

export type RiskBandName = (typeof RISK_BANDS)[number]["band"];

const factorInputSchema = z
  .number()
  .min(0, "Risk factor inputs must be between 0 and 100")
  .max(100, "Risk factor inputs must be between 0 and 100");

export const riskFactorInputsSchema = z.object({
  dataSensitivity: factorInputSchema.optional(),
  businessCriticality: factorInputSchema.optional(),
  accessPrivilege: factorInputSchema.optional(),
  operationalDependency: factorInputSchema.optional(),
  fourthPartyConcentration: factorInputSchema.optional(),
  geographicRegulatoryExposure: factorInputSchema.optional(),
});

export type RiskFactorInputs = z.infer<typeof riskFactorInputsSchema>;

export interface FactorContribution {
  factor: RiskFactorKey;
  weight: number;
  /** Raw 0-100 input value used. Missing inputs are treated as 0 and flagged. */
  value: number;
  /** weight * value, i.e. this factor's contribution to R_inherent before rounding. */
  contribution: number;
  wasProvided: boolean;
}

export interface InherentRiskResult {
  modelVersion: string;
  score: number;
  band: RiskBandName;
  factors: FactorContribution[];
  weights: typeof RISK_FACTOR_WEIGHTS;
  missingInputs: RiskFactorKey[];
  assumptions: string[];
}

export interface ResidualRiskResult {
  modelVersion: string;
  inherentScore: number;
  controlEffectiveness: number;
  score: number;
  band: RiskBandName;
  assumptions: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bandFor(score: number): RiskBandName {
  const band = RISK_BANDS.find((b) => score >= b.min && score <= b.max);
  // Score is always clamped to [0,100] before this is called, so a band
  // is guaranteed to exist; the fallback satisfies strict typing only.
  return band?.band ?? "CRITICAL";
}

/**
 * Calculates inherent risk (R_inherent) from the six weighted factors.
 * Any factor omitted from `inputs` is treated as 0 and reported in
 * `missingInputs` / `assumptions` so reviewers can see the score is
 * incomplete rather than silently trusting a falsely low result.
 */
export function calculateInherentRisk(rawInputs: RiskFactorInputs): InherentRiskResult {
  const inputs = riskFactorInputsSchema.parse(rawInputs);

  const missingInputs: RiskFactorKey[] = [];
  const factors: FactorContribution[] = (Object.keys(RISK_FACTOR_WEIGHTS) as RiskFactorKey[]).map(
    (factor) => {
      const weight = RISK_FACTOR_WEIGHTS[factor];
      const provided = inputs[factor];
      const wasProvided = typeof provided === "number";
      if (!wasProvided) missingInputs.push(factor);
      const value = wasProvided ? provided : 0;
      return {
        factor,
        weight,
        value,
        contribution: weight * value,
        wasProvided,
      };
    },
  );

  const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);
  const score = Math.round(clamp(rawScore, 0, 100) * 100) / 100;

  const assumptions: string[] = [];
  if (missingInputs.length > 0) {
    assumptions.push(
      `Missing factor inputs treated as 0 (lowest risk) for: ${missingInputs.join(", ")}. ` +
        "This score should be treated as provisional until the intake questionnaire is complete.",
    );
  }

  return {
    modelVersion: SCORING_MODEL_VERSION,
    score,
    band: bandFor(score),
    factors,
    weights: RISK_FACTOR_WEIGHTS,
    missingInputs,
    assumptions,
  };
}

/**
 * Calculates residual risk: R_residual = R_inherent * (1 - controlEffectiveness).
 * controlEffectiveness must be in [0, 1] (0 = no mitigating controls,
 * 1 = fully effective controls).
 */
export function calculateResidualRisk(
  inherentScore: number,
  controlEffectiveness: number,
): ResidualRiskResult {
  const clampedInherent = clamp(inherentScore, 0, 100);
  const clampedEffectiveness = clamp(controlEffectiveness, 0, 1);

  const assumptions: string[] = [];
  if (controlEffectiveness < 0 || controlEffectiveness > 1) {
    assumptions.push(
      `controlEffectiveness ${controlEffectiveness} was outside [0,1] and was clamped to ${clampedEffectiveness}.`,
    );
  }

  const rawScore = clampedInherent * (1 - clampedEffectiveness);
  const score = Math.round(clamp(rawScore, 0, 100) * 100) / 100;

  return {
    modelVersion: SCORING_MODEL_VERSION,
    inherentScore: clampedInherent,
    controlEffectiveness: clampedEffectiveness,
    score,
    band: bandFor(score),
    assumptions,
  };
}
