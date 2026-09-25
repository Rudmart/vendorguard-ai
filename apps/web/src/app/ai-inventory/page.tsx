"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import RegisterAiSystemButton from "./register-ai-system";
import AddAiSystemForm from "./add-ai-system-form";

type AiSystem = {
  id: string;
  name: string;
  description: string | null;
  origin: "INTERNAL" | "THIRD_PARTY";
  category: string;
  lifecycleStatus: string;
  riskTier: string | null;
  dataCategories: string[];
  updatedAt: string;
};

const ORIGIN_LABELS: Record<string, string> = { INTERNAL: "Internal", THIRD_PARTY: "Third Party" };

const RISK_TIER_COLORS: Record<string, string> = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
};

const LIFECYCLE_OPTIONS = ["PROPOSED", "DEVELOPMENT", "TESTING", "ASSESSMENT", "PENDING_APPROVAL", "APPROVED", "PRODUCTION", "SUSPENDED", "RETIRED"];

export default function AIInventoryPage() {
  const [systems, setSystems] = useState<AiSystem[] | null>(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [lifecycleFilter, setLifecycleFilter] = useState("");

  function load() {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d) => setSystems(d.aiSystems))
      .catch(() => setError(true));
  }

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI Inventory</h1>
        <div style={{ background: "#1a2340", border: "1px solid #ef4444", borderRadius: 10, padding: 20, color: "#f87171", fontSize: 13.5 }}>
          Something went wrong loading the AI Inventory. Please try again.
        </div>
      </main>
    );
  }

  if (systems === null) {
    return (
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI Inventory</h1>
        <p style={{ color: "#8b96ac", fontSize: 13.5 }}>Loading...</p>
      </main>
    );
  }

  const filtered = systems.filter((s) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (originFilter && s.origin !== originFilter) return false;
    if (lifecycleFilter && s.lifecycleStatus !== lifecycleFilter) return false;
    return true;
  });

  const inputStyle = {
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #2e3d63",
    background: "#1a2340",
    color: "#e6e9f0",
    fontSize: 13,
  };

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>AI Inventory</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 20 }}>
        {systems.length} AI system{systems.length === 1 ? "" : "s"} on record - internal and third-party, in one place. AI assists; humans govern.
      </p>

      <RegisterAiSystemButton>
        <AddAiSystemForm onCreated={load} />
      </RegisterAiSystemButton>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Search by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} style={inputStyle}>
          <option value="">All origins</option>
          <option value="INTERNAL">Internal</option>
          <option value="THIRD_PARTY">Third Party</option>
        </select>
        <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)} style={inputStyle}>
          <option value="">All lifecycle stages</option>
          {LIFECYCLE_OPTIONS.map((l) => (
            <option key={l} value={l}>{l.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      <div style={{ background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1.2fr 1.2fr 1fr 1.4fr",
            padding: "12px 20px",
            fontSize: 11.5,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "#5d6786",
            borderBottom: "1px solid #2e3d63",
          }}
        >
          <div>AI System</div>
          <div>Origin</div>
          <div>Category</div>
          <div>Lifecycle</div>
          <div>Risk Tier</div>
          <div>Data Categories</div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 24, color: "#8b96ac", fontSize: 13.5 }}>
            {systems.length === 0
              ? "No AI systems have been registered yet. Use \"Register AI System\" above to add the first one."
              : "No AI systems match your search or filters."}
          </div>
        ) : (
          filtered.map((s) => (
            <Link key={s.id} href={`/ai-systems/${s.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1.2fr 1.2fr 1fr 1.4fr",
                  padding: "14px 20px",
                  fontSize: 13,
                  borderBottom: "1px solid #2e3d63",
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ color: "#8b96ac" }}>{ORIGIN_LABELS[s.origin]}</div>
                <div style={{ color: "#8b96ac" }}>{s.category.replace(/_/g, " ")}</div>
                <div style={{ color: "#8b96ac" }}>{s.lifecycleStatus.replace(/_/g, " ")}</div>
                <div>
                  {s.riskTier ? (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: RISK_TIER_COLORS[s.riskTier] || "#8b96ac",
                        border: `1px solid ${RISK_TIER_COLORS[s.riskTier] || "#5d6786"}`,
                        borderRadius: 999,
                        padding: "2px 9px",
                      }}
                    >
                      {s.riskTier}
                    </span>
                  ) : (
                    <span style={{ color: "#5d6786", fontSize: 11.5 }}>Not set</span>
                  )}
                </div>
                <div style={{ color: "#8b96ac", fontSize: 12 }}>
                  {s.dataCategories.length > 0 ? s.dataCategories.join(", ") : "None"}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}