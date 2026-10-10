export const REPORT_DEFINITION_VERSION = "1.0";
export type ReportScope = "operational" | "historical" | "all";
export type ReportReference = {
  id: string;
  type: string;
  title: string;
  status: string;
  systemIds: string[];
  href: string;
  version?: number;
  ownerUserId?: string | null;
  decisions: {
    id: string;
    decision: string;
    actorUserId: string | null;
    at: string | null;
  }[];
  attributes: Record<string, string | number | boolean | null>;
};
export type ReportMetric = {
  key: string;
  label: string;
  section: string;
  definition: string;
  unit: string;
  lifecycleScope: ReportScope;
  drillDown: string;
} & (
  | { access: "AVAILABLE"; value: number; denominator: number | null }
  | { access: "RESTRICTED" }
);
export type GovernanceReport = {
  definitionVersion: string;
  generatedAt: string;
  scope: { aiSystemId: string | null; lifecycleScope: ReportScope };
  metrics: ReportMetric[];
  limitations: string[];
};
export type ReportRecords = {
  definitionVersion: string;
  generatedAt: string;
  metric: ReportMetric;
  records: ReportReference[];
  total: number;
  nextCursor: string | null;
};
