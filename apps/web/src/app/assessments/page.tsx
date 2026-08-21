"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Assessment = {
  id: string;
  status: string;
  createdAt: string;
  vendor: { id: string; legalName: string };
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#8b96ac",
  IN_PROGRESS: "#eab308",
  COMPLETE: "#22c55e",
};

export default function AssessmentsPage() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/assessments`, {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.assessments)) {
          setItems(data.assessments);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Assessment Workspace</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {items.length} assessment{items.length === 1 ? "" : "s"} across your portfolio
      </p>

      {loading ? (
        <p style={{ color: "#8b96ac" }}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>
          No assessments yet. Start one from a vendor&apos;s detail page.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => {
            const color = STATUS_COLORS[item.status] ?? "#8b96ac";
            return (
              <Link
                key={item.id}
                href={`/assessments/${item.id}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    background: "#1a2340",
                    border: "1px solid #2e3d63",
                    borderRadius: 10,
                    padding: "14px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.vendor.legalName}</div>
                    <div style={{ fontSize: 11.5, color: "#5d6786", marginTop: 2 }}>
                      Started {new Date(item.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 700,
                      color,
                      border: `1px solid ${color}`,
                      borderRadius: 999,
                      padding: "4px 12px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.status.replace(/_/g, " ")}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
