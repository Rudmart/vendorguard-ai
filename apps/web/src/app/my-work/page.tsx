"use client";

import { ListPage, formatDate, link, td, th, useList, words } from "../_lists/ui";

type Item = { type: string; id: string; title: string; context: string; state: string; due: string | null; href: string };

export default function MyWorkPage() {
  const { data, error } = useList<{ items: Item[] }>("/my-work");
  const rows = data?.items ?? [];
  return (
    <ListPage
      title="My Work"
      purpose="Open work you own or are assigned to - Findings, remediation, risk treatment, monitoring checks and assessments in progress. Not everything you can see; only what is yours to move forward."
      error={error}
      loading={!data}
      empty={data && rows.length === 0 ? "Nothing assigned to you right now." : null}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Type", "Item", "Context", "State", "Due"].map((h) => (
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
              <td style={td}>{r.state}</td>
              <td style={td}>{formatDate(r.due)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ListPage>
  );
}