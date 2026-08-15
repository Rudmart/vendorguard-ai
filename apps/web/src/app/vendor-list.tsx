"use client";

import Link from "next/link";
import { useState } from "react";

type VendorRisk = {
  band: string;
  score: number;
};

type Vendor = {
  id: string;
  legalName: string;
  serviceDescription: string;
  serviceCategory: string;
  criticality: string | null;
  risk: VendorRisk | null;
};

function riskColor(band: string) {
  switch (band) {
    case "CRITICAL":
      return "#ef4444";
    case "HIGH":
      return "#f97316";
    case "MODERATE":
      return "#eab308";
    default:
      return "#22c55e";
  }
}

function RiskBar({ risk }: { risk: VendorRisk | null }) {
  if (!risk) {
    return (
      <div style={{ fontSize: 12, color: "#5d6786" }}>Insufficient evidence</div>
    );
  }
  const color = riskColor(risk.band);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: "#1a2438", position: "relative", overflow: "hidden" }}>
        <div
          style={{
            width: `${risk.score}%`,
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg, #22c55e, #eab308, #ef4444)`,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color,
          border: `1px solid ${color}`,
          borderRadius: 999,
          padding: "2px 10px",
          whiteSpace: "nowrap",
        }}
      >
        {risk.band}
      </span>
      <span style={{ fontSize: 12, color: "#8b96ac", whiteSpace: "nowrap" }}>
        {risk.score}/100
      </span>
    </div>
  );
}

export default function VendorList({ vendors }: { vendors: Vendor[] }) {
  const [query, setQuery] = useState("");

  const filtered = vendors.filter((vendor) => {
    const haystack = `${vendor.legalName} ${vendor.serviceDescription} ${vendor.serviceCategory}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <>
      <input
        type="text"
        placeholder="Search vendors..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 10,
          padding: "12px 16px",
          color: "#e5e9f0",
          fontSize: 14,
          marginBottom: 24,
        }}
      />

      {filtered.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>
          {vendors.length === 0 ? "No vendors yet." : "No vendors match your search."}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
          {filtered.map((vendor) => (
            <Link key={vendor.id} href={`/vendors/${vendor.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div
                style={{
                  background: "#1a2340",
                  border: "1px solid #2e3d63",
                  borderRadius: 10,
                  padding: "16px 20px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{vendor.legalName}</div>
                  <div style={{ color: "#5d6786", fontSize: 12 }}>
                    {vendor.criticality || "Not set"}
                  </div>
                </div>
                <div style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 2, marginBottom: 12 }}>
                  {vendor.serviceDescription} &middot; {vendor.serviceCategory}
                </div>
                <RiskBar risk={vendor.risk} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

