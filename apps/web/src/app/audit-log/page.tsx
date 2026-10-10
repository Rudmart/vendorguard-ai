"use client";
import { useState } from "react";
import { useList, ListPage, control, td, th, muted } from "../_lists/ui";
type Event = {
  id: string;
  actorUserId: string | null;
  actorSystem: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  createdAt: string;
  metadataJson: Record<string, string | number | null>;
};
export default function AuditLogPage() {
  const [filters, setFilters] = useState({
    action: "",
    targetType: "",
    targetId: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState(""),
    [cursor, setCursor] = useState("");
  const query = new URLSearchParams(applied);
  if (cursor) query.set("cursor", cursor);
  const { data, error } = useList<{
    events: Event[];
    nextCursor: string | null;
  }>("/audit-events?" + query);
  return (
    <ListPage
      title="Audit Log"
      purpose="Tenant-scoped authoritative audit events. Narrative metadata is intentionally excluded."
      error={error}
      loading={!data && !error}
      empty={
        data?.events.length === 0 ? "No audit events in this filter." : null
      }
      controls={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = new URLSearchParams();
            for (const [key, value] of Object.entries(filters))
              if (value) q.set(key, value);
            setApplied(q.toString());
            setCursor("");
          }}
        >
          {Object.entries(filters).map(([key, value]) => (
            <label key={key} style={muted}>
              {key}
              <input
                style={control}
                value={value}
                placeholder={
                  key === "from" || key === "to" ? "UTC ISO timestamp" : key
                }
                onChange={(e) =>
                  setFilters({ ...filters, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <button style={control}>Apply filters</button>
        </form>
      }
    >
      {data && (
        <>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                {[
                  "UTC time",
                  "Actor",
                  "Action/result",
                  "Target",
                  "Safe metadata",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.events.map((event) => (
                <tr key={event.id}>
                  <td style={td}>{event.createdAt}</td>
                  <td style={td}>
                    {event.actorUserId ?? event.actorSystem ?? "Unavailable"}
                  </td>
                  <td style={td}>
                    {event.action}
                    <div>{event.outcome}</div>
                  </td>
                  <td style={td}>
                    {event.targetType}
                    <div style={muted}>{event.targetId}</div>
                  </td>
                  <td style={td}>
                    {Object.entries(event.metadataJson).map(([k, v]) => (
                      <div key={k}>
                        {k}: {String(v ?? "")}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={control} onClick={() => setCursor("")}>
            First page
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
