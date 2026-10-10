"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ReportRecords } from "@vendorguard/shared";
import { useList, ListPage, control, td, th, muted } from "../../../_lists/ui";
function Records() {
  const params = useSearchParams();
  const [cursor, setCursor] = useState("");
  const query = new URLSearchParams();
  for (const key of ["metric", "lifecycleScope", "aiSystemId"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  if (cursor) query.set("cursor", cursor);
  const { data, error } = useList<ReportRecords>(
    "/reports/ai-governance/records?" + query.toString(),
  );
  return (
    <ListPage
      title={data?.metric.label ?? "Report source records"}
      purpose="Live source records. Open the authoritative workflow to inspect evidence and human decisions."
      error={error}
      loading={!data && !error}
      empty={
        data?.records.length === 0 ? "No records match this metric." : null
      }
    >
      {data && (
        <>
          <p style={muted}>
            {data.metric.definition} · Generated UTC: {data.generatedAt} ·
            Total: {data.total}
          </p>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                {[
                  "Record",
                  "Status/version",
                  "Sources and human decisions",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.type + r.id}>
                  <td style={td}>
                    <a style={{ color: "#93c5fd" }} href={r.href}>
                      {r.title}
                    </a>
                    <div style={muted}>
                      {r.type} · {r.id}
                    </div>
                  </td>
                  <td style={td}>
                    {r.status}
                    {r.version ? " · v" + r.version : ""}
                    <div style={muted}>
                      Owner: {r.ownerUserId ?? "See source record"}
                    </div>
                  </td>
                  <td style={td}>
                    {r.systemIds.map((id) => (
                      <div key={id}>
                        <a
                          href={"/ai-systems/" + id}
                          style={{ color: "#93c5fd" }}
                        >
                          AI system {id}
                        </a>
                      </div>
                    ))}
                    {Object.entries(r.attributes).map(([key, value]) => (
                      <div key={key} style={muted}>
                        {key}: {String(value ?? "unavailable")}
                      </div>
                    ))}
                    {r.decisions.map((d) => (
                      <div key={d.id} style={muted}>
                        Human decision {d.decision} · {d.id} · actor{" "}
                        {d.actorUserId ?? "unavailable"} ·{" "}
                        {d.at ?? "unavailable"}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={control} onClick={() => setCursor("")}>
            First page / refresh
          </button>
          {data.nextCursor && (
            <button style={control} onClick={() => setCursor(data.nextCursor!)}>
              Next page
            </button>
          )}
        </>
      )}
    </ListPage>
  );
}
export default function ReportRecordsPage() {
  return (
    <Suspense fallback={<p>Loading source records...</p>}>
      <Records />
    </Suspense>
  );
}
