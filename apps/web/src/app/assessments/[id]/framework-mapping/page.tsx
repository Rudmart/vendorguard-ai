"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type MappingRow = {
  framework: string;
  requirement: string;
  applicability: boolean;
  applicabilityReason: string;
  evidence: { filename: string; page: number | null; section: string | null }[];
  controlStatus: string;
  gaps: string[];
  risk: { score: number; band: string | null };
  remediation: { title: string; status: string; dueDate: string | null }[];
};

const STATUS_COLORS: Record<string, string> = {
  PASS: "#22c55e",
  PARTIAL: "#eab308",
  FAIL: "#ef4444",
  INSUFFICIENT_EVIDENCE: "#8b96ac",
  CONFLICTING_EVIDENCE: "#f97316",
  NOT_APPLICABLE: "#5d6786",
};

const BAND_COLORS: Record<string, string> = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
};

export default function FrameworkMappingPage() {
  const params = useParams();
  const assessmentId = params.id as string;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  const [rows, setRows] = useState<MappingRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const res = await fetch(`${apiUrl}/assessments/${assessmentId}/framework-mapping`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows);
      }
      setLoading(false);
    }
    load();
  }, [assessmentId, apiUrl]);

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Framework Requirement Mapping</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        Every requirement shown here is applicable based on real vendor data - hover the reason to see why.
        Nothing is hardcoded; changing the vendor&apos;s profile changes what appears.
      </p>

      {loading && <p style={{ color: "#8b96ac" }}>Loading...</p>}

      {!loading && rows && rows.length === 0 && (
        <p style={{ color: "#8b96ac" }}>No applicable requirements found for this assessment&apos;s vendor profile.</p>
      )}

      {!loading && rows && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row, i) => {
            const statusColor = STATUS_COLORS[row.controlStatus] ?? "#8b96ac";
            const bandColor = row.risk.band ? BAND_COLORS[row.risk.band] ?? "#8b96ac" : "#5d6786";
            return (
              <div
                key={i}
                style={{
                  background: "#1a2340",
                  border: "1px solid #2e3d63",
                  borderRadius: 10,
                  padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: "#8b96ac" }}>{row.framework}</div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{row.requirement}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#000",
                        background: statusColor,
                        borderRadius: 6,
                        padding: "3px 8px",
                      }}
                    >
                      {row.controlStatus}
                    </span>
                    {row.risk.band && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#000",
                          background: bandColor,
                          borderRadius: 6,
                          padding: "3px 8px",
                        }}
                      >
                        {row.risk.band} ({row.risk.score.toFixed(0)})
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#c3cad9", marginBottom: 8 }} title={row.applicabilityReason}>
                  <strong>Why applicable:</strong> {row.applicabilityReason}
                </div>

                {row.gaps.length > 0 && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <strong>Gaps:</strong> {row.gaps.join("; ")}
                  </div>
                )}

                {row.evidence.length > 0 && (
                  <div style={{ fontSize: 12, marginBottom: 6 }}>
                    <strong>Evidence:</strong>{" "}
                    {row.evidence.map((e, j) => (
                      <span key={j}>
                        {e.filename}
                        {e.page ? ` (p.${e.page})` : ""}
                        {j < row.evidence.length - 1 ? "; " : ""}
                      </span>
                    ))}
                  </div>
                )}

                {row.remediation.length > 0 && (
                  <div style={{ fontSize: 12 }}>
                    <strong>Remediation:</strong>{" "}
                    {row.remediation.map((r, j) => (
                      <span key={j}>
                        {r.title} ({r.status})
                        {j < row.remediation.length - 1 ? "; " : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}