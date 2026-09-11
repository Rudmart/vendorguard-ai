"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import AssistantPanel from "./assistant-panel";

const industries = ["Banking & Financial", "Healthcare", "General"];

export default function TopHeader() {
  const [activeIndustry, setActiveIndustry] = useState("Banking & Financial");
  const [chatOpen, setChatOpen] = useState(false);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const pathname = usePathname();

  const vendorMatch = pathname.match(/^\/vendors\/([^/]+)/);
  const vendorId = vendorMatch ? vendorMatch[1] : null;

  useEffect(() => {
    if (!vendorId) {
      setVendorName(null);
      return;
    }
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVendorName(data?.legalName ?? null))
      .catch(() => setVendorName(null));
  }, [vendorId]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "14px 24px",
        borderBottom: "1px solid #2e3d63",
        background: "#141b2d",
      }}
    >
      <div
        style={{
          flex: 1,
          maxWidth: 480,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 10,
          padding: "8px 14px",
          color: "#8b96ac",
          fontSize: 13.5,
        }}
      >
        <span>Search vendors, controls, evidence...</span>
        <span
          style={{
            fontSize: 10.5,
            border: "1px solid #2e3d63",
            borderRadius: 4,
            padding: "1px 6px",
            color: "#5d6786",
          }}
        >
          &#8984;K
        </span>
      </div>

      <div
        style={{
          display: "flex",
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 999,
          padding: 3,
        }}
      >
        {industries.map((industry) => (
          <button
            key={industry}
            onClick={() => setActiveIndustry(industry)}
            style={{
              border: "none",
              background: activeIndustry === industry ? "#3b82f6" : "transparent",
              color: activeIndustry === industry ? "#fff" : "#8b96ac",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 999,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {industry}
          </button>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#3b82f6",
            display: "inline-block",
          }}
        />
        NEXAIGLOBAL
      </div>

      <button
        onClick={() => setChatOpen(true)}
        style={{
          border: "1px solid #2e3d63",
          background: "#1a2340",
          borderRadius: 10,
          width: 34,
          height: 34,
          cursor: "pointer",
          color: "#8b96ac",
          fontSize: 15,
        }}
        aria-label="AI Assistant"
      >
        &#128172;
      </button>

      <AssistantPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        vendorId={vendorId}
        vendorName={vendorName}
      />
    </div>
  );
}