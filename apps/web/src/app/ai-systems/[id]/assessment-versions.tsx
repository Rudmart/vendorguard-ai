"use client";

/** Phase D1 - one consistent version presentation for Risk and Impact Assessments. */
export type VersionRow = { id: string; version: number; status: string };

export function summarizeVersions<T extends VersionRow>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => b.version - a.version);
  const latest = sorted[0] ?? null;
  const latestCompleted = sorted.find((r) => r.status === "COMPLETED") ?? null;
  // A new version may only be started when there is none yet, or the newest one is COMPLETED.
  const canStart = !latest || latest.status === "COMPLETED";
  return { sorted, latest, latestCompleted, canStart };
}

export function readableStatus(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

function badge(color: string) {
  return { fontSize: 11, color, border: `1px solid ${color}`, borderRadius: 999, padding: "1px 8px", whiteSpace: "nowrap" as const };
}

export default function VersionList<T extends VersionRow>({
  rows,
  hrefBase,
  detail,
}: {
  rows: T[];
  hrefBase: string;
  detail?: (row: T) => string;
}) {
  const { sorted, latestCompleted } = summarizeVersions(rows);
  if (sorted.length === 0) {
    return null;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
      {sorted.map((row) => {
        const isLatestAssessed = latestCompleted?.id === row.id;
        const completed = row.status === "COMPLETED";
        return (
          <a
            key={row.id}
            href={hrefBase + row.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              background: "#0a0f1a",
              border: "1px solid #233150",
              borderRadius: 8,
              padding: "10px 14px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <strong style={{ fontSize: 13.5, minWidth: 28 }}>v{row.version}</strong>
            <span style={{ fontSize: 12.5, color: "#c7d0e3" }}>{completed ? "Completed" : readableStatus(row.status)}</span>
            {isLatestAssessed && <span style={badge("#4ade80")}>Latest assessed</span>}
            {completed && !isLatestAssessed && <span style={badge("#94a3b8")}>History</span>}
            {!completed && <span style={badge("#fbbf24")}>In progress - not yet assessed</span>}
            {detail && <span style={{ fontSize: 12, color: "#8b96ac", marginLeft: "auto" }}>{detail(row)}</span>}
          </a>
        );
      })}
    </div>
  );
}