"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type AiSystem = {
  id: string;
  name: string;
  description: string | null;
  origin: "INTERNAL" | "THIRD_PARTY";
  category: string;
  lifecycleStatus: string;
  ownerUserId: string | null;
  dataCategories: string[];
  riskTier: string | null;
  createdAt: string;
  updatedAt: string;
};

type VendorLink = {
  id: string;
  vendorId: string;
  role: string;
  vendor: { id: string; legalName: string };
};

type Vendor = { id: string; legalName: string };

const LIFECYCLE_OPTIONS = ["PROPOSED", "DEVELOPMENT", "TESTING", "ASSESSMENT", "PENDING_APPROVAL", "APPROVED", "PRODUCTION", "SUSPENDED", "RETIRED"];
const VENDOR_ROLES = ["PRIMARY_PROVIDER", "MODEL_PROVIDER", "PLATFORM_PROVIDER", "AI_SERVICE_PROVIDER", "DATA_PROVIDER", "DEVELOPMENT_PROVIDER", "OTHER"];

export default function AiSystemDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [aiSystem, setAiSystem] = useState<AiSystem | null>(null);
  const [vendorLinks, setVendorLinks] = useState<VendorLink[] | null>(null);
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [notFound, setNotFound] = useState(false);

  const [lifecycleDraft, setLifecycleDraft] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  const [linkVendorId, setLinkVendorId] = useState("");
  const [linkRole, setLinkRole] = useState("OTHER");
  const [linkError, setLinkError] = useState("");
  const [linking, setLinking] = useState(false);

  function loadAiSystem() {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}`, { credentials: "include" })
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((d) => {
        if (d) {
          setAiSystem(d);
          setLifecycleDraft(d.lifecycleStatus);
        }
      })
      .catch(() => setNotFound(true));
  }

  function loadVendorLinks() {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/vendors`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { vendorLinks: [] }))
      .then((d) => setVendorLinks(d.vendorLinks))
      .catch(() => setVendorLinks([]));
  }

  useEffect(() => {
    if (!id) return;
    loadAiSystem();
    loadVendorLinks();
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { vendors: [] }))
      .then((d) => setAllVendors(d.vendors))
      .catch(() => setAllVendors([]));
      }, [id]);

  async function handleLifecycleUpdate() {
    setLifecycleSaving(true);
    setLifecycleError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lifecycleStatus: lifecycleDraft }),
      });
      if (res.status === 403) {
        setLifecycleError("You don't have permission to change this AI system's lifecycle status.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLifecycleError(body?.error || "Something went wrong updating the lifecycle status.");
        return;
      }
      loadAiSystem();
    } catch {
      setLifecycleError("Something went wrong updating the lifecycle status.");
    } finally {
      setLifecycleSaving(false);
    }
  }

  async function handleLinkVendor(e: React.FormEvent) {
    e.preventDefault();
    setLinking(true);
    setLinkError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/vendors`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId: linkVendorId, role: linkRole }),
      });
      if (res.status === 403) {
        setLinkError("You don't have permission to link vendors to this AI system.");
        return;
      }
      if (res.status === 409) {
        setLinkError("This vendor is already linked with that role.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setLinkError(body?.error || "Something went wrong linking the vendor.");
        return;
      }
      setLinkVendorId("");
      setLinkRole("OTHER");
      loadVendorLinks();
    } catch {
      setLinkError("Something went wrong linking the vendor.");
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink(linkId: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/vendors/${linkId}`, {
      method: "DELETE",
      credentials: "include",
    });
    loadVendorLinks();
  }

  if (notFound) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <h1 style={{ fontSize: 24 }}>AI System not found</h1>
        <p style={{ color: "#8b96ac", fontSize: 13.5 }}>
          This AI system doesn&apos;t exist, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  if (!aiSystem) {
    return (
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <p style={{ color: "#8b96ac", fontSize: 13.5 }}>Loading...</p>
      </main>
    );
  }

  const cardStyle = { background: "#1a2340", border: "1px solid #2e3d63", borderRadius: 10, padding: 20, marginBottom: 20 };
  const labelStyle = { color: "#5d6786", fontSize: 11.5, textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 };
  const valueStyle = { color: "#e6e9f0", fontSize: 14, marginBottom: 14 };
  const selectStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #2e3d63", background: "#0a0f1a", color: "#e6e9f0", fontSize: 13 };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{aiSystem.name}</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24, fontStyle: "italic" }}>
        AI assists. Humans govern.
      </p>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Overview</h2>
        <div style={labelStyle}>Description</div>
        <div style={valueStyle}>{aiSystem.description || "No description provided."}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={labelStyle}>Origin</div>
            <div style={valueStyle}>{aiSystem.origin === "INTERNAL" ? "Internal" : "Third Party"}</div>
          </div>
          <div>
            <div style={labelStyle}>Category</div>
            <div style={valueStyle}>{aiSystem.category.replace(/_/g, " ")}</div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Governance</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={labelStyle}>Owner</div>
            <div style={{ ...valueStyle, color: "#5d6786", fontStyle: "italic" }}>
              Owner assignment picker not available in this version.
            </div>
          </div>
          <div>
            <div style={labelStyle}>Risk Tier</div>
            <div style={valueStyle}>{aiSystem.riskTier || "Not set"}</div>
          </div>
        </div>
        <div style={labelStyle}>Data Categories</div>
        <div style={valueStyle}>{aiSystem.dataCategories.length > 0 ? aiSystem.dataCategories.join(", ") : "None recorded"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={labelStyle}>Created</div>
            <div style={valueStyle}>{new Date(aiSystem.createdAt).toLocaleDateString()}</div>
          </div>
          <div>
            <div style={labelStyle}>Last Updated</div>
            <div style={valueStyle}>{new Date(aiSystem.updatedAt).toLocaleDateString()}</div>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Lifecycle</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <select style={selectStyle} value={lifecycleDraft} onChange={(e) => setLifecycleDraft(e.target.value)}>
            {LIFECYCLE_OPTIONS.map((l) => (
              <option key={l} value={l}>{l.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button
            onClick={handleLifecycleUpdate}
            disabled={lifecycleSaving || lifecycleDraft === aiSystem.lifecycleStatus}
            style={{
              background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: lifecycleSaving ? "not-allowed" : "pointer",
              opacity: lifecycleSaving || lifecycleDraft === aiSystem.lifecycleStatus ? 0.6 : 1,
            }}
          >
            {lifecycleSaving ? "Saving..." : "Update Lifecycle"}
          </button>
        </div>
        {lifecycleError && (
          <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 12.5, marginTop: 8 }}>
            {lifecycleError}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Third-Party Dependencies</h2>
        <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
          {aiSystem.origin === "INTERNAL"
            ? "This is an internally owned AI system. It may still depend on external vendors below."
            : "This is a third-party AI system. At least one vendor relationship is required before it can move beyond Proposed."}
        </p>

        {vendorLinks === null ? (
          <p style={{ color: "#8b96ac", fontSize: 13 }}>Loading vendor relationships...</p>
        ) : vendorLinks.length === 0 ? (
          <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 16 }}>No vendors linked yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {vendorLinks.map((link) => (
              <div
                key={link.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#0a0f1a", border: "1px solid #233150", borderRadius: 8, padding: "10px 14px",
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{link.vendor.legalName}</span>
                  <span style={{ color: "#8b96ac", fontSize: 12, marginLeft: 8 }}>{link.role.replace(/_/g, " ")}</span>
                </div>
                <button
                  onClick={() => handleUnlink(link.id)}
                  style={{ background: "none", border: "1px solid #5d6786", color: "#8b96ac", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}
                >
                  Unlink
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleLinkVendor} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select style={selectStyle} value={linkVendorId} onChange={(e) => setLinkVendorId(e.target.value)} required>
            <option value="">Select a vendor...</option>
            {allVendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </select>
          <select style={selectStyle} value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
            {VENDOR_ROLES.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={linking || !linkVendorId}
            style={{
              background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
              padding: "8px 16px", fontSize: 13, fontWeight: 600,
              cursor: linking ? "not-allowed" : "pointer", opacity: linking ? 0.6 : 1,
            }}
          >
            {linking ? "Linking..." : "Link Vendor"}
          </button>
        </form>
        {linkError && (
          <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 12.5, marginTop: 10 }}>
            {linkError}
          </div>
        )}
      </div>
    </main>
  );
}