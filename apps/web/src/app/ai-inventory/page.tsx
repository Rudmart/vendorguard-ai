"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type AIVendor = {
  id: string;
  legalName: string;
  serviceCategory: string;
  aiFunctionality: boolean;
};

type AIInventoryData = {
  totalVendors: number;
  aiVendorCount: number;
  vendors: AIVendor[];
};

export default function AIInventoryPage() {
  const [data, setData] = useState<AIInventoryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-inventory`, { credentials: "include" })
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Loading...</main>;
  }
  if (!data) {
    return <main style={{ padding: 32, color: "#8b96ac" }}>Failed to load AI inventory.</main>;
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI Inventory</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {data.aiVendorCount} of {data.totalVendors} vendors report AI functionality
      </p>

      {data.vendors.length === 0 ? (
        <div
          style={{
            background: "#1a2340",
            border: "1px solid #2e3d63",
            borderRadius: 10,
            padding: 24,
            color: "#8b96ac",
            fontSize: 13.5,
          }}
        >
          No vendors are currently flagged as using AI. Mark a vendor as AI-enabled
          from its detail page to see it appear here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.vendors.map((v) => (
            <Link key={v.id} href={`/vendors/${v.id}`} style={{ textDecoration: "none", color: "inherit" }}>
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
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v.legalName}</div>
                  <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 2 }}>{v.serviceCategory}</div>
                </div>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: "#a78bfa",
                    border: "1px solid #a78bfa",
                    borderRadius: 999,
                    padding: "3px 10px",
                  }}
                >
                  AI-ENABLED
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
