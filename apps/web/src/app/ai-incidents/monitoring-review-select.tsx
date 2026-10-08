"use client";
import { useEffect, useState } from "react";
import { API, control } from "../_lists/ui";
export default function MonitoringReviewSelect({
  aiSystemId,
  value,
  onChange,
}: {
  aiSystemId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [reviews, setReviews] = useState<
    { id: string; observation: string; result: string; check: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReviews([]);
    setError(null);
    async function load() {
      if (!aiSystemId) return;
      const response = await fetch(
        `${API}/ai-systems/${aiSystemId}/monitoring-checks`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("Could not load monitoring checks");
      const data = (await response.json()) as {
        checks: { id: string; title: string }[];
      };
      const results = await Promise.all(
        data.checks.map(async (c) => {
          const r = await fetch(`${API}/ai-monitoring-checks/${c.id}/reviews`, {
            credentials: "include",
          });
          if (!r.ok) throw new Error("Could not load monitoring reviews");
          const d = (await r.json()) as {
            reviews: { id: string; observation: string; result: string }[];
          };
          return d.reviews.map((review) => ({ ...review, check: c.title }));
        }),
      );
      if (!cancelled) setReviews(results.flat());
    }
    void load().catch((e) => {
      if (!cancelled) setError(e.message);
    });
    return () => {
      cancelled = true;
    };
  }, [aiSystemId]);
  return (
    <>
      <select
        style={control}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">No source monitoring review</option>
        {reviews.map((r) => (
          <option key={r.id} value={r.id}>
            {r.check}: {r.observation.slice(0, 100)} ({r.result})
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
