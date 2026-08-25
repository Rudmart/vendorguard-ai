import { z } from "zod";
import { calculateResidualRisk, bandFor, clamp, SCORING_MODEL_VERSION, type RiskBandName } from "./scoring.js";

/**
 * Configurable AI Vendor Risk Rating engine (Milestone 5).
 *
 * DESIGN PRINCIPLE: Weights are data, not hardcoded logic - this keeps the
 * door open for a future Administration UI to override them, while
 * defaulting to a sensible, documented starting point. Every calculation
 * stores the exact weights used, so past ratings remain reproducible even
 * if the defaults change later.
 *
 * This engine is independent from the AI Risk Assessment (M2) and AI
 * Impact Assessment (M3) engines - it does not modify or replace them.
 * It mixes general TPRM factors (Business Criticality, Vendor Maturity)
 * with AI-specific factors (AI Autonomy, Model Risk) into one configurable
 * rating.
 */

export const DEFAULT_RISK_RATING_WEIGHTS = {
  businessCriticality: 0.20,
  dataSensitivity: 0.20,
  aiAutonomy: 0.15,
  regulatoryExposure: 0.15,
  securityPosture: 0.15,
  modelRisk: 0.10,
  vendorMaturity: 0.05,
} as const;

export type RiskRatingFactorKey = keyof typeof DEFAULT_RISK_RATING_WEIGHTS;
export type RiskRatingWeights = Record<RiskRatingFactorKey, number>;

function assertWeightsSumToOne(weights: RiskRatingWeights) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`Risk rating weights must sum to 1.0, got ${sum}`);
  }
}
assertWeightsSumToOne(DEFAULT_RISK_RATING_WEIGHTS);

const factorInputSchema = z.number().min(0).max(100).optional();

export const riskRatingFactorInputsSchema = z.object({
  businessCriticality: factorInputSchema,
  dataSensitivity: factorInputSchema,
  aiAutonomy: factorInputSchema,
  regulatoryExposure: factorInputSchema,
  securityPosture: factorInputSchema,
  modelRisk: factorInputSchema,
  vendorMaturity: factorInputSchema,
});

export type RiskRatingFactorInputs = z.infer<typeof riskRatingFactorInputsSchema>;

export interface RiskRatingFactorContribution {
  factor: RiskRatingFactorKey;
  weight: number;
  value: number;
  contribution: number;
  wasProvided: boolean;
}

export interface InherentRiskRatingResult {
  modelVersion: string;
  score: number;
  factors: RiskRatingFactorContribution[];
  weights: RiskRatingWeights;
  missingInputs: RiskRatingFactorKey[];
  assumptions: string[];
}

export interface FullRiskRatingResult {
  inherent: InherentRiskRatingResult;
  controlEffectiveness: number;
  residualScore: number;
  finalRating: RiskBandName;
}

/**
 * Calculates the Inherent Risk stage of the configurable Risk Rating engine.
 * Accepts an optional custom weights object (e.g. from a future
 * Administration UI); defaults to DEFAULT_RISK_RATING_WEIGHTS. Missing
 * inputs are treated as 0 and flagged, never silently assumed safe -
 * consistent with the rest of the risk-engine package.
 */
export function calculateInherentRiskRating(
  rawInputs: RiskRatingFactorInputs,
  weights: RiskRatingWeights = DEFAULT_RISK_RATING_WEIGHTS,
): InherentRiskRatingResult {
  assertWeightsSumToOne(weights);
  const inputs = riskRatingFactorInputsSchema.parse(rawInputs);

  const missingInputs: RiskRatingFactorKey[] = [];
  const factors: RiskRatingFactorContribution[] = (Object.keys(weights) as RiskRatingFactorKey[]).map(
    (factor) => {
      const weight = weights[factor];
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
      `Missing risk rating factor inputs treated as 0 (lowest risk) for: ${missingInputs.join(", ")}. ` +
        "This rating should be treated as provisional until all inputs are complete.",
    );
  }

  return {
    modelVersion: SCORING_MODEL_VERSION,
    score,
    factors,
    weights,
    missingInputs,
    assumptions,
  };
}

/**
 * Runs the full 4-stage pipeline: Inherent Risk -> Control Effectiveness
 * (caller-supplied) -> Residual Risk -> Final Risk Rating. Reuses the
 * existing calculateResidualRisk() from scoring.ts rather than
 * duplicating that logic.
 */
export function calculateFullRiskRating(
  rawInputs: RiskRatingFactorInputs,
  controlEffectiveness: number,
  weights: RiskRatingWeights = DEFAULT_RISK_RATING_WEIGHTS,
): FullRiskRatingResult {
  const inherent = calculateInherentRiskRating(rawInputs, weights);
  const residualResult = calculateResidualRisk(inherent.score, controlEffectiveness);

  return {
    inherent,
    controlEffectiveness: clamp(controlEffectiveness, 0, 1),
    residualScore: residualResult.score,
    finalRating: residualResult.band,
  };
}