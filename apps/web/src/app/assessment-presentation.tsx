/** Display-only normalization. Stored names, versions and queue payloads are unchanged. */
export function assessmentDisplayName(name: string, version: number): string {
  const generated = /^(?:AI )?(Risk|Impact) Assessment(?: v(\d+)| \(version (\d+)\))?$/i.exec(name);
  if (!generated || (generated[2] ?? generated[3]) && Number(generated[2] ?? generated[3]) !== version) {
    return name;
  }
  return `AI ${generated[1].toLowerCase() === "risk" ? "Risk" : "Impact"} Assessment`;
}

export function AssessmentLabel({ name, version }: { name: string; version: number }) {
  return <>{assessmentDisplayName(name, version)} <span>Version {version}</span></>;
}

export function assessmentTypeLabel(type: string): string | null {
  switch (type) {
    case "RISK_ASSESSMENT": return "AI risk assessment";
    case "IMPACT_ASSESSMENT": return "AI impact assessment";
    case "RISK_ASSESSMENT_REVIEW": return "AI risk assessment review";
    case "IMPACT_ASSESSMENT_REVIEW": return "AI impact assessment review";
    default: return null;
  }
}

export function WorkItemLabel({ type, title }: { type: string; title: string }) {
  // Only assessment queues have the API's appended version suffix; other titles are untouched.
  const queued = assessmentTypeLabel(type) ? /^(.*) \(v(\d+)\)$/.exec(title) : null;
  return queued ? <AssessmentLabel name={queued[1]} version={Number(queued[2])} /> : <>{title}</>;
}
