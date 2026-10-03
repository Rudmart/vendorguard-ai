"use client";

import { ListPage, formatDate, link, muted, td, th, useList, words } from "../../_lists/ui";

type Item = { type: string; id: string; title: string; context: string; since: string | null; why: string; href: string };

export default function PendingReviewsPage() {
  const { data, error } = useList<{ items: Item[] }>("/reviews/pending");
  const vendor = useList<unknown>("/reviews/findings");
  const vendorCount = Array.isArray(vendor.data) ? vendor.data.length : ((vendor.data as { findings?: unknown[] } | null)?.findings?.length ?? 0);
  const rows = data?.items ?? [];
  return (
    <ListPage
      title="Pending Reviews"
      purpose="Decisions you are eligible to make now - your role allows it and separation of duties does not prevent it (you did not create, request, submit, own or assess the item). Open an item to decide it in its authoritative workflow."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "No AI governance decisions are waiting for you." : null}
      controls={
        <p style={{ ...muted, margin: 0 }}>
          Vendor finding reviews for you: {vendorCount}.{" "}
          <a style={link} href="/governance/reviews">
            Open vendor finding reviews
          </a>
        </p>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Decision", "Item", "AI system", "Pending since", "Why you can decide"].map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type + r.id}>
              <td style={td}>{words(r.type)}</td>
              <td style={td}>
                <a style={link} href={r.href}>
                  {r.title}
                </a>
              </td>
              <td style={td}>{r.context}</td>
              <td style={td}>{formatDate(r.since)}</td>
              <td style={td}>{r.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}