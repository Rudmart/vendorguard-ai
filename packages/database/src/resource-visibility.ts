import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

/** Populated only after membership resolution and isolated for each request. */
export const resourceScope = new AsyncLocalStorage<{ tenantId?: string }>();
export const frameworkVisibility = (tenantId: string) => ({
  OR: [{ tenantId: null }, { tenantId }],
});
export const controlVisibility = (tenantId: string) => ({
  frameworkVersion: { framework: frameworkVisibility(tenantId) },
});

function visibility(
  model: string,
  tenantId: string,
): Record<string, unknown> | undefined {
  const control = controlVisibility(tenantId),
    mapped = { control },
    test = { aiSystemControl: mapped };
  const finding = { OR: [{ aiControlTestId: null }, { aiControlTest: test }] };
  const risk = { OR: [{ controlId: null }, { control }] };
  return (
    {
      Framework: frameworkVisibility(tenantId),
      FrameworkVersion: { framework: frameworkVisibility(tenantId) },
      Control: control,
      ControlMapping: { fromControl: control, toControl: control },
      AssessmentFramework: { framework: frameworkVisibility(tenantId) },
      AiSystemFrameworkApplicability: {
        framework: frameworkVisibility(tenantId),
      },
      AiRisk: risk,
      ControlFinding: { control },
      AiSystemControl: mapped,
      AiControlTest: test,
      AiControlTestEvidence: { test },
      AiSystemControlEvidence: { aiSystemControl: mapped },
      GovernanceFinding: finding,
      FindingEvidence: { finding: { control } },
      RemediationAction: {
        AND: [
          {
            OR: [{ governanceFindingId: null }, { governanceFinding: finding }],
          },
          { OR: [{ aiRiskId: null }, { aiRisk: risk }] },
        ],
      },
      RiskAcceptance: { OR: [{ aiRiskId: null }, { aiRisk: risk }] },
    } as Record<string, Record<string, unknown>>
  )[model];
}

// Apply additional required-relation guards only when private reference data is
// actually selected. Repeating an unrelated source-applicability chain in every
// test/evidence/finding read adds avoidable joins while holding governance locks.
function selectedPrivateRelations(
  model: string,
  args: Record<string, unknown>,
  tenantId: string,
): Record<string, unknown> {
  const selection = (args.select ?? args.include ?? {}) as Record<
    string,
    unknown
  >;
  const guard: Record<string, unknown> = {};
  for (const field of Prisma.dmmf.datamodel.models.find((m) => m.name === model)
    ?.fields ?? []) {
    const child = selection[field.name];
    if (field.kind !== "object" || field.isList || !child) continue;
    let nested: Record<string, unknown> | undefined;
    if (
      ["Framework", "FrameworkVersion", "Control", "ControlMapping"].includes(
        field.type,
      )
    ) {
      nested = visibility(field.type, tenantId);
    } else if (typeof child === "object") {
      nested = selectedPrivateRelations(
        field.type,
        child as Record<string, unknown>,
        tenantId,
      );
    }
    if (!nested || !Object.keys(nested).length) continue;
    if (field.isRequired) guard[field.name] = nested;
    else {
      const nullField =
        field.relationFromFields?.length === 1
          ? field.relationFromFields[0]!
          : field.name;
      const condition = {
        OR: [{ [nullField]: null }, { [field.name]: nested }],
      };
      const alternatives = (guard.AND ??= []) as unknown[];
      alternatives.push(condition);
    }
  }
  return Object.keys(guard).length === 1 &&
    Array.isArray(guard.AND) &&
    guard.AND.length === 1
    ? (guard.AND[0] as Record<string, unknown>)
    : guard;
}

function uncoveredRelations(
  guard: Record<string, unknown>,
  policy: Record<string, unknown> = {},
) {
  for (const key of Object.keys(guard)) {
    if (JSON.stringify(guard[key]) === JSON.stringify(policy[key]))
      delete guard[key];
    else if (
      guard[key] &&
      policy[key] &&
      typeof guard[key] === "object" &&
      typeof policy[key] === "object" &&
      !Array.isArray(guard[key]) &&
      !Array.isArray(policy[key])
    ) {
      uncoveredRelations(
        guard[key] as Record<string, unknown>,
        policy[key] as Record<string, unknown>,
      );
      if (!Object.keys(guard[key] as object).length) delete guard[key];
    }
  }
  return guard;
}

/** Filter before retrieval, including lists nested under authorized parents.
 * Required to-one control paths are protected by their enclosing model policy.
 * Historical records are never deleted by visibility enforcement.
 */
export function scopeResourceRead(
  model: string,
  args: Record<string, unknown>,
  tenantId: string,
  root = true,
  project = true,
  inheritedVisibility = false,
) {
  const local = copyQuery(args);
  applyResourceScope(
    model,
    local,
    tenantId,
    root,
    project,
    inheritedVisibility,
  );
  return local;
}

// Copy query containers, retaining Prisma scalar instances (Date, Decimal,
// Buffer, etc.). Only request-local containers may receive visibility guards.
function copyQuery<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyQuery) as T;
  if (!value || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, copyQuery(child)]),
  ) as T;
}

function applyResourceScope(
  model: string,
  args: Record<string, unknown>,
  tenantId: string,
  root: boolean,
  project: boolean,
  inheritedVisibility: boolean,
) {
  const logicalPolicy = visibility(model, tenantId);
  const policy = inheritedVisibility ? undefined : logicalPolicy;
  const selectedGuard = uncoveredRelations(
    selectedPrivateRelations(model, args, tenantId),
    logicalPolicy,
  );
  if (root && (policy || Object.keys(selectedGuard).length)) {
    const where = (args.where ?? {}) as Record<string, unknown>;
    args.where = {
      ...where,
      AND: [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
            ? [where.AND]
            : []),
        ...(policy ? [policy] : []),
        ...(Object.keys(selectedGuard).length ? [selectedGuard] : []),
      ],
    };
  }
  const definition = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
  if (
    project &&
    model === "ControlFinding" &&
    (args.include || args.select || root)
  ) {
    const selection = (args.select ?? (args.include ??= {})) as Record<
      string,
      unknown
    >;
    if (args.select)
      for (const field of [
        "id",
        "controlId",
        "assessmentId",
        "status",
        "requiresHumanReview",
        "proposedByUserId",
        "proposedStatus",
      ])
        selection[field] = true;
    selection.reviewDecisions ??= { select: { id: true }, take: 1 };
  }
  if (
    project &&
    root &&
    ["AiUseCase", "AiRiskAssessment", "AiImpactAssessment"].includes(model) &&
    !args.select
  ) {
    const include = (args.include ??= {}) as Record<string, unknown>;
    include.decisionHistory ??= { orderBy: { createdAt: "asc" } };
  }
  for (const key of ["select", "include"]) {
    const selection = args[key] as Record<string, unknown> | undefined;
    if (!selection) continue;
    for (const field of definition?.fields ?? []) {
      if (field.kind !== "object" || !selection[field.name]) continue;
      let child = selection[field.name];
      if (child === true && field.isList && visibility(field.type, tenantId))
        child = selection[field.name] = {};
      if (child && typeof child === "object") {
        // A child FK pointing back to an already-filtered parent cannot change
        // that parent's framework visibility. Avoid rejoining the same chain
        // for every included evidence/test/history collection.
        const childPolicy = visibility(field.type, tenantId);
        const back = Prisma.dmmf.datamodel.models
          .find((m) => m.name === field.type)
          ?.fields.find(
            (f) =>
              f.kind === "object" &&
              !f.isList &&
              f.type === model &&
              f.relationName === field.relationName,
          );
        const inherits = Boolean(
          field.isList &&
            (root || inheritedVisibility) &&
            logicalPolicy &&
            back &&
            childPolicy &&
            Object.keys(childPolicy).length === 1 &&
            JSON.stringify(childPolicy[back.name]) ===
              JSON.stringify(logicalPolicy),
        );
        applyResourceScope(
          field.type,
          child as Record<string, unknown>,
          tenantId,
          field.isList,
          project,
          inherits,
        );
      }
    }
  }
}

/** Quarantine unattributed legacy dispositions in responses without rewriting history. */
export function normalizeLegacyFindings(
  value: unknown,
  model: string,
): unknown {
  if (Array.isArray(value))
    return value.map((row) => normalizeLegacyFindings(row, model));
  if (!value || typeof value !== "object" || value instanceof Date)
    return value;
  const row = value as Record<string, unknown>;
  if (
    model === "ControlFinding" &&
    "controlId" in row &&
    "assessmentId" in row &&
    "requiresHumanReview" in row &&
    !row.proposedByUserId &&
    Array.isArray(row.reviewDecisions) &&
    !row.reviewDecisions.length
  ) {
    row.proposedStatus ??= row.status;
    row.status = "INSUFFICIENT_EVIDENCE";
    row.requiresHumanReview = true;
    row.governanceAttribution = "RECONCILIATION_REQUIRED";
  }
  // Traverse ORM relationships only; immutable audit/context JSON is not a
  // current finding and must retain its original historical values.
  for (const field of Prisma.dmmf.datamodel.models.find((m) => m.name === model)
    ?.fields ?? [])
    if (field.kind === "object" && field.name in row)
      row[field.name] = normalizeLegacyFindings(row[field.name], field.type);
  return row;
}
