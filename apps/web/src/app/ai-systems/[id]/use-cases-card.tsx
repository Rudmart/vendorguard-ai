"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "../../current-user";
import { Badge } from "../../_lists/ui";
import { STATUS_COLORS, readable } from "../../ai-use-cases/use-case-form";

const API = process.env.NEXT_PUBLIC_API_URL;

type UseCaseRow = { id: string; name: string; status: string; owner: { displayName: string } | null };

/** AI Use Cases V1 - how and why this AI system is used. Self-contained; does not touch the other cards. */
export default function UseCasesCard({ aiSystemId }: { aiSystemId: string }) {
  const [items, setItems] = useState<UseCaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = useCurrentUser();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/ai-systems/${aiSystemId}/use-cases`, { credentials: "include" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { useCases?: UseCaseRow[]; error?: string } | null;
        if (cancelled) {
          return;
        }
        if (!res.ok) {
          setError(data?.error ?? `Could not load use cases (${res.status}).`);
          setItems([]);
          return;
        }
        setItems(data?.useCases ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not reach the server. Check that the API is running.");
          setItems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aiSystemId]);

  return (
    <div style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>AI Use Cases</h2>
      <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>
        How and why this AI system is used. Each use case has an accountable owner and is approved by a human reviewer.
      </p>
      {items === null && <p style={{ color: "#8b96ac", fontSize: 13 }}>Loading...</p>}
      {error && (
        <p role="alert" style={{ color: "#f87171", fontSize: 13 }}>
          {error}
        </p>
      )}
      {items !== null && items.length === 0 && !error && <p style={{ color: "#8b96ac", fontSize: 13 }}>No use cases recorded for this AI system yet.</p>}
      {items !== null && items.length > 0 && (
        <ol style={{ paddingLeft: 20, margin: "0 0 12px 0" }}>
          {items.map((u) => (
            <li key={u.id} style={{ fontSize: 13.5, padding: "4px 0" }}>
              <a href={`/ai-use-cases/${u.id}`} style={{ color: "#93c5fd", textDecoration: "none" }}>
                {u.name}
              </a>{" "}
              <Badge text={readable(u.status)} color={STATUS_COLORS[u.status] ?? "#8b96ac"} />
              {u.owner && <span style={{ color: "#8b96ac", fontSize: 12 }}> - owner {u.owner.displayName}</span>}
            </li>
          ))}
        </ol>
      )}
      {items !== null && can("ai-system:update") && (
        <a
          href={`/ai-use-cases?aiSystemId=${aiSystemId}`}
          style={{ background: "#3b82f6", color: "#fff", borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 600, textDecoration: "none", display: "inline-block" }}
        >
          + Add use case
        </a>
      )}
    </div>
  );
}
