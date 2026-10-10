import {
  REPORT_DEFINITION_VERSION,
  type GovernanceReport,
  type ReportMetric,
  type ReportReference,
} from "@vendorguard/shared";
import type { ReportData, ReportFilter } from "./aiGovernanceReportData.js";
import { deriveAcceptanceState } from "./aiRiskAcceptance.js";
import {
  nextDueDate,
  dueState,
  ACCEPTANCE_EXPIRING_DAYS,
} from "./aiMonitoring.js";
import { deriveAssuranceStatus } from "./aiControlEvidence.js";

const DAY = 86400000;
type Decision = ReportReference["decisions"][number];
const decision = (
  id: string,
  value: string | null,
  actor: string | null,
  at: Date | null,
): Decision[] =>
  value
    ? [
        {
          id,
          decision: value,
          actorUserId: actor,
          at: at?.toISOString() ?? null,
        },
      ]
    : [];
const reviews = (
  rows: {
    id: string;
    decision: string;
    reviewerUserId: string;
    createdAt: Date;
  }[],
) =>
  rows.map((r) => ({
    id: r.id,
    decision: r.decision,
    actorUserId: r.reviewerUserId,
    at: r.createdAt.toISOString(),
  }));
function latestCompleted<
  T extends { id: string; aiSystemId: string; version: number; status: string },
>(rows: T[]) {
  const map = new Map<string, T>();
  for (const r of rows)
    if (
      r.status === "COMPLETED" &&
      (!map.has(r.aiSystemId) || map.get(r.aiSystemId)!.version < r.version)
    )
      map.set(r.aiSystemId, r);
  return map;
}
/** One predicate produces both the metric and the exact supporting record set. */
export function buildReport(data: ReportData, filter: ReportFilter) {
  const now = data.generatedAt.getTime();
  const records = new Map<string, ReportReference[]>();
  const metrics: ReportMetric[] = [];
  const retired = new Set(
    data.systems
      .filter((s) => s.lifecycleStatus === "RETIRED")
      .map((s) => s.id),
  );
  const selected = new Set(
    data.systems
      .filter(
        (s) =>
          filter.lifecycleScope === "all" ||
          (filter.lifecycleScope === "historical"
            ? retired.has(s.id)
            : !retired.has(s.id)),
      )
      .map((s) => s.id),
  );
  const inScope = (r: ReportReference) =>
    r.systemIds.some((id) => selected.has(id));
  const ref = (
    id: string,
    type: string,
    title: string,
    status: string,
    systemIds: string[],
    href: string,
    attributes: ReportReference["attributes"] = {},
    decisions: Decision[] = [],
    ownerUserId?: string | null,
  ): ReportReference => ({
    id,
    type,
    title,
    status,
    systemIds: [...new Set(systemIds)],
    href,
    attributes,
    decisions,
    ...(ownerUserId !== undefined ? { ownerUserId } : {}),
  });
  function add(
    key: string,
    label: string,
    section: string,
    definition: string,
    rows: ReportReference[],
    denominator: number | null = null,
    scope = filter.lifecycleScope,
    unit = "records",
    restricted = false,
  ) {
    const unique = [
      ...new Map(rows.map((r) => [r.type + ":" + r.id, r])).values(),
    ].sort((a, b) => a.id.localeCompare(b.id));
    const query = new URLSearchParams({
      metric: key,
      lifecycleScope: filter.lifecycleScope,
      ...(filter.aiSystemId ? { aiSystemId: filter.aiSystemId } : {}),
    });
    const base = {
      key,
      label,
      section,
      definition,
      unit,
      lifecycleScope: scope,
      drillDown: "/reports/ai-governance/records?" + query,
    };
    metrics.push(
      restricted
        ? { ...base, access: "RESTRICTED" }
        : { ...base, access: "AVAILABLE", value: unique.length, denominator },
    );
    if (!restricted) records.set(key, unique);
  }
  function byStatus(
    prefix: string,
    label: string,
    section: string,
    rows: ReportReference[],
    statuses: readonly string[],
    definition: string,
  ) {
    for (const status of statuses)
      add(
        prefix + "." + status,
        label + " — " + status,
        section,
        definition + "; status = " + status,
        rows.filter((r) => r.status === status),
      );
  }
  const systems = data.systems.map((s) =>
    ref(
      s.id,
      "AiSystem",
      s.name,
      s.lifecycleStatus,
      [s.id],
      "/ai-systems/" + s.id,
      { retiredAt: s.retiredAt?.toISOString() ?? null },
      [],
      s.ownerUserId,
    ),
  );
  const operational = systems.filter((s) => !retired.has(s.id)),
    historical = systems.filter((s) => retired.has(s.id)),
    scopedSystems = systems.filter(inScope);
  add(
    "systems.operational",
    "Non-retired AI systems",
    "Portfolio",
    "Tenant systems whose lifecycle is not RETIRED; not synonymous with production",
    operational,
    null,
    "operational",
    "AI systems",
  );
  add(
    "systems.historical",
    "Retired AI systems",
    "Portfolio",
    "Tenant systems whose lifecycle is RETIRED; retained history",
    historical,
    null,
    "historical",
    "AI systems",
  );
  add(
    "systems.production",
    "Production AI systems",
    "Portfolio",
    "Non-retired systems with PRODUCTION lifecycle",
    operational.filter((s) => s.status === "PRODUCTION"),
    null,
    "operational",
    "AI systems",
  );
  add(
    "systems.withoutOwner",
    "Systems without an assigned owner",
    "Portfolio",
    "Systems in selected scope with no recorded owner; does not assess owner eligibility",
    scopedSystems.filter((s) => !s.ownerUserId),
  );
  const riskLatest = latestCompleted(data.riskAssessments),
    impactLatest = latestCompleted(data.impactAssessments);
  for (const [name, latest] of [
    ["risk", riskLatest],
    ["impact", impactLatest],
  ] as const) {
    add(
      name + ".coverage",
      "Completed " + name + " assessment coverage",
      "Assessments",
      "Non-retired systems with any completed " +
        name +
        " assessment / non-retired systems; newer drafts do not replace completed posture",
      operational.filter((s) => latest.has(s.id)),
      operational.length,
      "operational",
      "AI systems",
    );
    add(
      name + ".missing",
      "No completed " + name + " assessment",
      "Assessments",
      "Non-retired systems without a completed " + name + " assessment",
      operational.filter((s) => !latest.has(s.id)),
      null,
      "operational",
      "AI systems",
    );
  }
  const assessments = (
    rows: ReportData["riskAssessments"],
    type: string,
    path: string,
    applyScope = true,
  ) =>
    rows
      .map((a) => ({
        ...ref(
          a.id,
          type,
          a.name,
          a.status,
          [a.aiSystemId],
          path + a.id,
          {},
          decision(a.id, a.reviewDecision, a.reviewerUserId, a.reviewedAt),
        ),
        version: a.version,
      }))
      .filter((r) => !applyScope || inScope(r));
  const riskAs = assessments(
    data.riskAssessments,
    "AiRiskAssessment",
    "/ai-risk-assessments/",
  );
  const impactAs = assessments(
    data.impactAssessments,
    "AiImpactAssessment",
    "/ai-impact-assessments/",
  );
  byStatus(
    "riskAssessments",
    "Risk assessments",
    "Assessments",
    riskAs,
    ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED"],
    "Assessment records in selected lifecycle scope; all versions",
  );
  byStatus(
    "impactAssessments",
    "Impact assessments",
    "Assessments",
    impactAs,
    ["DRAFT", "IN_PROGRESS", "READY_FOR_REVIEW", "COMPLETED"],
    "Assessment records in selected lifecycle scope; all versions",
  );
  const assessmentMap = new Map(data.riskAssessments.map((a) => [a.id, a]));
  const allRisks = data.risks.flatMap((r) => {
    const a = assessmentMap.get(r.assessmentId);
    return a
      ? [
          {
            ...ref(
              r.id,
              "AiRisk",
              r.title,
              r.residualRating ?? "NOT_ASSESSED",
              [a.aiSystemId],
              "/ai-risk-assessments/" + a.id,
              { assessmentId: a.id },
              [],
              r.treatmentOwnerUserId,
            ),
            version: a.version,
          },
        ]
      : [];
  });
  const riskItems = allRisks.filter(
    (r) =>
      inScope(r) &&
      riskLatest.get(r.systemIds[0]!)?.id === r.attributes.assessmentId,
  );
  byStatus(
    "risks",
    "Residual risk items",
    "Risk posture",
    riskItems,
    ["LOW", "MODERATE", "HIGH", "CRITICAL", "NOT_ASSESSED"],
    "Risk ITEMS from the highest completed assessment version per system; not system counts",
  );
  const impactMap = new Map(data.impactAssessments.map((a) => [a.id, a]));
  const impactItems = data.impacts
    .flatMap((i) => {
      const a = impactMap.get(i.assessmentId);
      return a && impactLatest.get(a.aiSystemId)?.id === a.id
        ? [
            {
              ...ref(
                i.id,
                "AiImpact",
                i.title,
                i.direction,
                [a.aiSystemId],
                "/ai-impact-assessments/" + a.id,
                { assessmentId: a.id, severity: i.severity },
              ),
              version: a.version,
            },
          ]
        : [];
    })
    .filter(inScope);
  byStatus(
    "impacts",
    "Recorded impact items",
    "Impact posture",
    impactItems,
    ["BENEFICIAL", "ADVERSE"],
    "Impact items from highest completed impact assessment; severity is recorded 1–5, not a combined score",
  );
  const useCases = data.useCases
    .map((u) =>
      ref(
        u.id,
        "AiUseCase",
        u.name,
        u.status,
        [u.aiSystemId],
        "/ai-use-cases/" + u.id,
        {},
        decision(u.id, u.reviewDecision, u.reviewerUserId, u.reviewedAt),
        u.ownerUserId,
      ),
    )
    .filter(inScope);
  byStatus(
    "useCases",
    "AI use cases",
    "Use cases",
    useCases,
    ["DRAFT", "PENDING_REVIEW", "APPROVED", "SUSPENDED", "RETIRED"],
    "Use-case records, distinct from parent-system lifecycle",
  );
  const frameworks = data.frameworks
    .map((f) =>
      ref(
        f.id,
        "AiSystemFrameworkApplicability",
        f.framework.name,
        f.status,
        [f.aiSystemId],
        "/ai-systems/" + f.aiSystemId,
        {},
        decision(f.id, f.status, f.determinedByUserId, f.determinedAt),
      ),
    )
    .filter(inScope);
  byStatus(
    "frameworks",
    "Framework applicability",
    "Controls",
    frameworks,
    ["APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE", "NEEDS_REVIEW"],
    "Human-recorded applicability; no compliance determination",
  );
  add(
    "frameworks.missing",
    "Systems without a recorded framework determination",
    "Controls",
    "Selected systems without any human-recorded framework applicability; absence is not NOT_APPLICABLE",
    scopedSystems.filter(
      (s) => !data.frameworks.some((f) => f.aiSystemId === s.id),
    ),
  );
  const controlMap = new Map(data.controls.map((c) => [c.id, c]));
  const applicableFrameworkIds = new Set(
    data.frameworks
      .filter((f) => ["APPLICABLE", "PARTIALLY_APPLICABLE"].includes(f.status))
      .map((f) => f.id),
  );
  const controls = data.controls
    .map((c) =>
      ref(
        c.id,
        "AiSystemControl",
        c.control.title,
        c.applicability,
        [c.aiSystemId],
        "/ai-system-controls/" + c.id + "/evidence",
        {
          implementationStatus: c.implementationStatus,
          sourceApplicabilityId: c.sourceApplicabilityId,
        },
        [],
        c.ownerUserId,
      ),
    )
    .filter(inScope);
  byStatus(
    "controls",
    "Mapped control applicability",
    "Controls",
    controls,
    ["APPLICABLE", "PARTIALLY_APPLICABLE", "NOT_APPLICABLE", "NOT_ASSESSED"],
    "Distinct mapped system-control records; mapping does not establish implementation or effectiveness",
  );
  for (const state of ["NOT_STARTED", "PLANNED", "IMPLEMENTED"])
    add(
      "implementation." + state,
      "Reported implementation — " + state,
      "Controls",
      "Recorded implementation status; not tested effectiveness",
      controls.filter((c) => c.attributes.implementationStatus === state),
    );
  add(
    "controls.withoutOwner",
    "Mapped controls without owner",
    "Controls",
    "Selected mapped controls not NOT_APPLICABLE with no recorded owner",
    controls.filter((c) => c.status !== "NOT_APPLICABLE" && !c.ownerUserId),
  );
  const testMap = new Map(data.tests.map((t) => [t.id, t]));
  const allTestRefs = data.tests.flatMap((t) => {
    const c = controlMap.get(t.aiSystemControlId);
    return c
      ? [
          ref(
            t.id,
            "AiControlTest",
            c.control.title + " test",
            t.status,
            [c.aiSystemId],
            "/ai-system-controls/" + c.id + "/evidence#test-" + t.id,
            {
              aiSystemControlId: c.id,
              overallEffectiveness: t.overallEffectiveness,
              nextTestDate: t.nextTestDate?.toISOString() ?? null,
            },
          ),
        ]
      : [];
  });
  const tests = allTestRefs.filter(inScope);
  byStatus(
    "tests",
    "Control tests",
    "Testing",
    tests,
    ["IN_PROGRESS", "COMPLETED"],
    "All control-test records; unfinished tests remain unfinished",
  );
  const latestTests = new Map<string, ReportData["tests"][number]>();
  for (const t of [...data.tests]
    .filter((t) => t.status === "COMPLETED")
    .sort(
      (a, b) =>
        (b.testDate?.getTime() ?? 0) - (a.testDate?.getTime() ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        b.id.localeCompare(a.id),
    )) {
    if (!latestTests.has(t.aiSystemControlId))
      latestTests.set(t.aiSystemControlId, t);
  }
  const applicableControls = controls.filter(
    (c) =>
      ["APPLICABLE", "PARTIALLY_APPLICABLE"].includes(c.status) &&
      applicableFrameworkIds.has(String(c.attributes.sourceApplicabilityId)),
  );
  add(
    "tests.coverage",
    "Applicable controls with completed testing",
    "Testing",
    "Currently applicable/partially applicable mapped controls under applicable frameworks with a completed test / those controls",
    applicableControls.filter((c) => latestTests.has(c.id)),
    applicableControls.length,
    filter.lifecycleScope,
    "system controls",
  );
  add(
    "tests.missing",
    "Applicable controls without completed testing",
    "Testing",
    "Currently applicable controls under applicable frameworks without a completed test",
    applicableControls.filter((c) => !latestTests.has(c.id)),
  );
  const latestTestRefs = tests.filter(
    (t) => latestTests.get(String(t.attributes.aiSystemControlId))?.id === t.id,
  );
  for (const value of [
    "NOT_ASSESSED",
    "INEFFECTIVE",
    "PARTIALLY_EFFECTIVE",
    "EFFECTIVE",
  ])
    add(
      "effectiveness." + value,
      "Latest completed effectiveness — " + value,
      "Testing",
      "Latest completed test per selected mapped control; no automatic compliance conclusion",
      latestTestRefs.filter((t) => t.attributes.overallEffectiveness === value),
    );
  add(
    "tests.retestOverdue",
    "Completed tests requiring retest",
    "Testing",
    "Latest completed tests with nextTestDate earlier than generation time",
    latestTestRefs.filter(
      (t) =>
        typeof t.attributes.nextTestDate === "string" &&
        Date.parse(t.attributes.nextTestDate) < now,
    ),
  );
  const incidents = data.incidents.map((i) =>
    ref(
      i.id,
      "AiIncident",
      i.title,
      i.status,
      [i.aiSystemId],
      "/ai-incidents/" + i.id,
      { severity: i.severity },
      reviews(i.reviews),
      i.ownerUserId,
    ),
  );
  byStatus(
    "incidents",
    "Incidents",
    "Incidents",
    incidents.filter(inScope),
    ["OPEN", "IN_PROGRESS", "PENDING_REVIEW", "CLOSED"],
    "Distinct incident records in selected scope",
  );
  for (const severity of ["LOW", "MEDIUM", "HIGH", "CRITICAL"])
    add(
      "incidentSeverity." + severity,
      "Unresolved incidents — " + severity,
      "Incidents",
      "Incidents not CLOSED, grouped by severity",
      incidents.filter(
        (i) =>
          inScope(i) &&
          i.status !== "CLOSED" &&
          i.attributes.severity === severity,
      ),
    );
  const incidentMap = new Map(data.incidents.map((i) => [i.id, i]));
  const findings = data.findings.map((f) => {
    const t = f.aiControlTestId ? testMap.get(f.aiControlTestId) : null,
      c = t ? controlMap.get(t.aiSystemControlId) : null;
    const ids = [
      ...(c ? [c.aiSystemId] : []),
      ...data.incidentLinks
        .filter((l) => l.findingId === f.id)
        .flatMap((l) => incidentMap.get(l.incidentId)?.aiSystemId ?? []),
    ];
    return ref(
      f.id,
      "GovernanceFinding",
      f.title,
      f.status,
      ids,
      c
        ? "/ai-system-controls/" + c.id + "/evidence#finding-" + f.id
        : "/ai-incidents/" +
            data.incidentLinks.find((l) => l.findingId === f.id)?.incidentId +
            "#finding-" +
            f.id,
      { severity: f.severity, aiControlTestId: f.aiControlTestId },
      reviews(f.reviews),
      f.ownerUserId,
    );
  });
  byStatus(
    "findings",
    "Findings",
    "Findings",
    findings.filter(inScope),
    ["PENDING_REVIEW", "OPEN", "DISMISSED", "CLOSED"],
    "Distinct governance findings associated through tenant-owned controls or incidents; multiple links count once",
  );
  add(
    "findings.highCritical",
    "HIGH/CRITICAL unresolved findings",
    "Findings",
    "OPEN or PENDING_REVIEW findings of HIGH/CRITICAL severity; not accepted or closed by reporting",
    findings.filter(
      (f) =>
        inScope(f) &&
        ["OPEN", "PENDING_REVIEW"].includes(f.status) &&
        ["HIGH", "CRITICAL"].includes(String(f.attributes.severity)),
    ),
  );
  add(
    "findings.highCriticalOpen",
    "HIGH/CRITICAL open findings",
    "Findings",
    "OPEN findings of HIGH/CRITICAL severity; pending review remains a distinct status",
    findings.filter(
      (f) =>
        inScope(f) &&
        f.status === "OPEN" &&
        ["HIGH", "CRITICAL"].includes(String(f.attributes.severity)),
    ),
  );
  const riskMap = new Map(allRisks.map((r) => [r.id, r])),
    findingMap = new Map(findings.map((f) => [f.id, f]));
  const remediations = data.remediations.map((r) =>
    ref(
      r.id,
      "RemediationAction",
      r.title,
      r.status,
      [
        ...(r.aiRiskId ? (riskMap.get(r.aiRiskId)?.systemIds ?? []) : []),
        ...(r.governanceFindingId
          ? (findingMap.get(r.governanceFindingId)?.systemIds ?? [])
          : []),
      ],
      r.governanceFindingId
        ? (findingMap.get(r.governanceFindingId)?.href ?? "/remediation")
        : r.aiRiskId
          ? (riskMap.get(r.aiRiskId)?.href ?? "/remediation")
          : "/remediation",
      {
        dueDate: r.dueDate?.toISOString() ?? null,
        governanceFindingId: r.governanceFindingId,
        aiRiskId: r.aiRiskId,
      },
      r.verifications.map((v) => ({
        id: v.id,
        decision: v.decision,
        actorUserId: v.verifierUserId,
        at: v.createdAt.toISOString(),
      })),
      r.ownerUserId,
    ),
  );
  byStatus(
    "remediation",
    "Remediation",
    "Remediation",
    remediations.filter(inScope),
    ["OPEN", "IN_PROGRESS", "OVERDUE", "PENDING_VERIFICATION", "CLOSED"],
    "Distinct AI-associated remediation records; explicit relationship paths, not absence of vendorId",
  );
  add(
    "remediation.overdue",
    "Overdue remediation",
    "Remediation",
    "Not CLOSED with dueDate earlier than generation time; subset of status counts",
    remediations.filter(
      (r) =>
        inScope(r) &&
        r.status !== "CLOSED" &&
        typeof r.attributes.dueDate === "string" &&
        Date.parse(r.attributes.dueDate) < now,
    ),
  );
  const acceptances = data.acceptances.flatMap((a) => {
    const r = a.aiRiskId ? riskMap.get(a.aiRiskId) : null;
    return r
      ? [
          ref(
            a.id,
            "RiskAcceptance",
            r.title,
            deriveAcceptanceState(a.status, a.expiresAt, now),
            r.systemIds,
            "/risk-acceptance/" + a.aiRiskId,
            {
              expiresAt: a.expiresAt?.toISOString() ?? null,
              residualRatingAtRequest: a.residualRatingAtRequest,
            },
            decision(
              a.id,
              a.status === "PENDING_REVIEW" ? null : a.status,
              a.decidedByUserId,
              a.decidedAt,
            ),
          ),
        ]
      : [];
  });
  byStatus(
    "acceptances",
    "Risk acceptances",
    "Accepted risk",
    acceptances.filter(inScope),
    ["PENDING_REVIEW", "ACTIVE", "EXPIRED", "REJECTED"],
    "APPROVED decision plus expiration determines ACTIVE/EXPIRED; treatment=ACCEPT alone is not acceptance",
  );
  add(
    "acceptances.expiring",
    "Active acceptances expiring within 30 days",
    "Accepted risk",
    "ACTIVE with recorded expiration no later than generation time + 30 days; subset of ACTIVE",
    acceptances.filter(
      (a) =>
        inScope(a) &&
        a.status === "ACTIVE" &&
        typeof a.attributes.expiresAt === "string" &&
        Date.parse(a.attributes.expiresAt) <=
          now + ACCEPTANCE_EXPIRING_DAYS * DAY,
    ),
  );
  const monitoring = data.monitoring.map((c) => {
    const last = c.reviews[0],
      due = nextDueDate(last?.reviewedAt ?? c.createdAt, c.cadence);
    return ref(
      c.id,
      "AiMonitoringCheck",
      c.title,
      dueState(due, c.active, now),
      [c.aiSystemId],
      "/ai-systems/" + c.aiSystemId + "/monitoring/" + c.id,
      { nextDueAt: due.toISOString(), latestResult: last?.result ?? null },
      last
        ? decision(last.id, last.result, last.reviewerUserId, last.reviewedAt)
        : [],
      c.ownerUserId,
    );
  });
  byStatus(
    "monitoring",
    "Monitoring checks",
    "Monitoring",
    monitoring.filter(inScope),
    ["INACTIVE", "OVERDUE", "DUE_SOON", "NOT_DUE"],
    "Existing cadence and seven-day due-soon rules, latest human review; inactive is separate",
  );
  const reassessments = data.reassessments.map((r) =>
    ref(
      r.id,
      "AiReassessment",
      r.reason,
      r.status,
      [r.aiSystemId],
      "/ai-systems/" + r.aiSystemId + "/reassessments/" + r.id,
      { targetDate: r.targetDate?.toISOString() ?? null },
      decision(r.id, r.conclusion, r.completedByUserId, r.completedAt),
      r.initiatedByUserId,
    ),
  );
  byStatus(
    "reassessments",
    "Reassessments",
    "Reassessments",
    reassessments.filter(inScope),
    ["IN_PROGRESS", "COMPLETED"],
    "Authoritative reassessment status, including unfinished retired-system work",
  );
  add(
    "reassessments.overdue",
    "Reassessments past target",
    "Reassessments",
    "IN_PROGRESS with targetDate earlier than generation time",
    reassessments.filter(
      (r) =>
        inScope(r) &&
        r.status === "IN_PROGRESS" &&
        typeof r.attributes.targetDate === "string" &&
        Date.parse(r.attributes.targetDate) < now,
    ),
  );
  const retirements = data.retirements.map((r) =>
    ref(
      r.id,
      "AiSystemRetirement",
      r.reason,
      r.status,
      [r.aiSystemId],
      "/ai-retirements/" + r.id,
      { requestedRetirementDate: r.requestedRetirementDate.toISOString() },
      reviews(r.reviews),
      r.requesterUserId,
    ),
  );
  byStatus(
    "retirements",
    "Retirement requests",
    "Retirement",
    retirements.filter(inScope),
    ["DRAFT", "PENDING_REVIEW", "COMPLETED", "CANCELLED"],
    "Recorded requests; request counts are not retired-system counts; dispositions remain on authoritative detail",
  );
  const allAssessmentRefs = [
    ...assessments(
      data.riskAssessments,
      "AiRiskAssessment",
      "/ai-risk-assessments/",
      false,
    ),
    ...assessments(
      data.impactAssessments,
      "AiImpactAssessment",
      "/ai-impact-assessments/",
      false,
    ),
  ];
  const followUp = [
    ...incidents.filter((r) => r.status !== "CLOSED"),
    ...findings.filter((r) => ["OPEN", "PENDING_REVIEW"].includes(r.status)),
    ...remediations.filter((r) => r.status !== "CLOSED"),
    ...reassessments.filter((r) => r.status === "IN_PROGRESS"),
    ...acceptances.filter((r) => r.status !== "REJECTED"),
    ...allAssessmentRefs.filter((r) => r.status !== "COMPLETED"),
    ...allTestRefs.filter((r) => r.status !== "COMPLETED"),
  ].filter((r) => r.systemIds.some((id) => retired.has(id)));
  add(
    "historical.followUp",
    "Retired-system follow-up obligations",
    "Historical follow-up",
    "Outstanding incidents/findings/remediation/reassessments/acceptances and unfinished work on retired systems; retained and never automatically resolved",
    followUp,
    null,
    "historical",
  );
  const pending = [
    ...riskAs,
    ...impactAs,
    ...useCases,
    ...findings.filter((r) => inScope(r)),
    ...acceptances.filter(inScope),
    ...incidents.filter(inScope),
    ...retirements.filter(inScope),
    ...remediations.filter(inScope),
  ].filter((r) =>
    ["PENDING_REVIEW", "READY_FOR_REVIEW", "PENDING_VERIFICATION"].includes(
      r.status,
    ),
  );
  add(
    "decisions.pending",
    "Pending human governance decisions",
    "Human decisions",
    "Tenant-wide pending review/verification records in selected scope; evidence reviews remain in the independently authorized evidence section; not personal My Work or reviewer eligibility",
    pending,
  );
  const vendors = data.vendorLinks
    .map((v) =>
      ref(
        v.id,
        "AiSystemVendor",
        "Vendor association",
        v.role,
        [v.aiSystemId],
        "/vendors/" + v.vendorId,
        { vendorId: v.vendorId },
      ),
    )
    .filter(inScope);
  add(
    "vendors.links",
    "AI system/vendor associations",
    "Portfolio",
    "Distinct association records; one vendor may have several roles or systems",
    vendors,
  );
  const evidence = data.evidence
    .map((e) => {
      const systemIds = [
        ...(e.aiSystemId && data.systems.some((s) => s.id === e.aiSystemId)
          ? [e.aiSystemId]
          : []),
        ...data.evidenceLinks
          .filter((l) => l.evidenceDocumentId === e.id)
          .flatMap(
            (l) => controlMap.get(l.aiSystemControlId)?.aiSystemId ?? [],
          ),
        ...data.incidentEvidence
          .filter((l) => l.evidenceDocumentId === e.id)
          .flatMap((l) => incidentMap.get(l.incidentId)?.aiSystemId ?? []),
        ...data.retirementEvidence
          .filter((l) => l.evidenceDocumentId === e.id)
          .flatMap(
            (l) =>
              data.retirements.find((r) => r.id === l.retirementId)
                ?.aiSystemId ?? [],
          ),
      ];
      const control = data.evidenceLinks.find(
          (l) => l.evidenceDocumentId === e.id,
        ),
        incident = data.incidentEvidence.find(
          (l) => l.evidenceDocumentId === e.id,
        ),
        retirement = data.retirementEvidence.find(
          (l) => l.evidenceDocumentId === e.id,
        );
      const href = control
        ? "/ai-system-controls/" +
          control.aiSystemControlId +
          "/evidence#evidence-" +
          e.id
        : incident
          ? "/ai-incidents/" + incident.incidentId
          : retirement
            ? "/ai-retirements/" + retirement.retirementId
            : "/ai-systems/" + systemIds[0];
      return ref(
        e.id,
        "EvidenceDocument",
        e.displayFilename,
        e.state,
        systemIds,
        href,
        { expirationDate: e.expirationDate?.toISOString() ?? null },
        data.evidenceLinks
          .filter((l) => l.evidenceDocumentId === e.id)
          .flatMap((l) => reviews(l.reviews)),
      );
    })
    .filter(inScope);
  add(
    "evidence.total",
    "Evidence documents",
    "Evidence",
    "Distinct non-deleted AI evidence documents; count does not imply acceptance or usability",
    evidence,
    null,
    filter.lifecycleScope,
    "documents",
    !data.evidenceAllowed,
  );
  for (const state of [
    "UPLOADED",
    "QUARANTINED",
    "SCANNING",
    "CLEAN",
    "REJECTED",
    "EXTRACTING",
    "INDEXED",
    "FAILED",
    "EXPIRED",
  ])
    add(
      "evidence." + state,
      "Evidence state — " + state,
      "Evidence",
      "Recorded processing state; independent of human link acceptance",
      evidence.filter((e) => e.status === state),
      null,
      filter.lifecycleScope,
      "documents",
      !data.evidenceAllowed,
    );
  add(
    "evidence.expired",
    "Evidence past expiration",
    "Evidence",
    "Recorded expiration at or before generation time; independent of processing status",
    evidence.filter(
      (e) =>
        typeof e.attributes.expirationDate === "string" &&
        Date.parse(e.attributes.expirationDate) <= now,
    ),
    null,
    filter.lifecycleScope,
    "documents",
    !data.evidenceAllowed,
  );
  const assurance = controls.map((c) => ({
    ...c,
    status: deriveAssuranceStatus(
      data.evidenceLinks
        .filter((l) => l.aiSystemControlId === c.id)
        .map((l) => l.status),
    ),
    decisions: data.evidenceLinks
      .filter((l) => l.aiSystemControlId === c.id)
      .flatMap((l) => reviews(l.reviews)),
  }));
  for (const state of ["NO_EVIDENCE", "PENDING_REVIEW", "ACCEPTED", "REJECTED"])
    add(
      "assurance." + state,
      "Control evidence assurance — " + state,
      "Evidence",
      "Existing human-reviewed link assurance; ACCEPTED does not establish current usable evidence or compliance",
      assurance.filter((c) => c.status === state),
      null,
      filter.lifecycleScope,
      "system controls",
      !data.evidenceAllowed,
    );
  const report: GovernanceReport = {
    definitionVersion: REPORT_DEFINITION_VERSION,
    generatedAt: data.generatedAt.toISOString(),
    scope: {
      aiSystemId: filter.aiSystemId ?? null,
      lifecycleScope: filter.lifecycleScope,
    },
    metrics,
    limitations: [
      "Live read snapshot; later drill-downs may reflect newer records.",
      "Source decision history is bounded to the latest 20 decisions per record; full history remains on authoritative detail pages.",
      "No governance score or compliance conclusion. Mapping, implementation, evidence assurance and effectiveness are distinct.",
      ...(!data.evidenceAllowed
        ? [
            "Evidence information is restricted by existing evidence permissions.",
          ]
        : []),
    ],
  };
  return { report, records };
}
