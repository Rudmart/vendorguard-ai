"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type TenantUser = { id: string; displayName: string; email: string };
type RiskAssessmentSummary = { id: string; name: string; status: string; risks: { inherentScore: number; residualScore: number | null }[] };

type AiSystem = {
  id: string;
  name: string;
  description: string | null;
  origin: "INTERNAL" | "THIRD_PARTY";
  category: string;
  lifecycleStatus: string;
  ownerUserId: string | null;
  owner: TenantUser | null;
  dataCategories: string[];
  riskTier: string | null;
  businessCriticality: string | null;
  decisionRole: string | null;
  humanOversight: string | null;
  impactLevel: string | null;
  dataSensitivity: string | null;
  affectedPopulation: string[];
  externalImpact: boolean | null;
  regulatoryRelevance: string[];
  assessmentStatus: string;
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
const BUSINESS_CRITICALITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const DECISION_ROLE_OPTIONS = ["ADVISORY", "RECOMMENDS", "DECIDES", "EXECUTES"];
const HUMAN_OVERSIGHT_OPTIONS = ["REQUIRED", "OPTIONAL", "NOT_APPLICABLE"];
const IMPACT_LEVEL_OPTIONS = ["LOW", "MODERATE", "HIGH"];
const DATA_SENSITIVITY_OPTIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
const AFFECTED_POPULATION_OPTIONS = ["EMPLOYEES", "CUSTOMERS", "PUBLIC", "OTHER"];
const REGULATORY_RELEVANCE_OPTIONS = ["EU_AI_ACT", "PRIVACY", "INDUSTRY_SPECIFIC", "OTHER"];
const ASSESSMENT_STATUS_OPTIONS = ["NOT_ASSESSED", "ASSESSMENT_REQUIRED", "ASSESSED"];

const DECISION_ROLE_HELP: Record<string, string> = {
  ADVISORY: "Provides information only.",
  RECOMMENDS: "Produces recommendations that humans evaluate.",
  DECIDES: "Makes decisions.",
  EXECUTES: "Can perform actions or transactions.",
};

export default function AiSystemDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const [aiSystem, setAiSystem] = useState<AiSystem | null>(null);
  const [vendorLinks, setVendorLinks] = useState<VendorLink[] | null>(null);
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([]);
  const [notFound, setNotFound] = useState(false);

  const [lifecycleDraft, setLifecycleDraft] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  const [linkVendorId, setLinkVendorId] = useState("");
  const [linkRole, setLinkRole] = useState("OTHER");
  const [linkError, setLinkError] = useState("");
  const [linking, setLinking] = useState(false);

  const [riskAssessments, setRiskAssessments] = useState<RiskAssessmentSummary[] | null>(null);

  const [govOwnerUserId, setGovOwnerUserId] = useState("");
  const [govBusinessCriticality, setGovBusinessCriticality] = useState("");
  const [govDecisionRole, setGovDecisionRole] = useState("");
  const [govHumanOversight, setGovHumanOversight] = useState("");
  const [govImpactLevel, setGovImpactLevel] = useState("");
  const [govDataSensitivity, setGovDataSensitivity] = useState("");
  const [govAffectedPopulation, setGovAffectedPopulation] = useState<string[]>([]);
  const [govExternalImpact, setGovExternalImpact] = useState(false);
  const [govRegulatoryRelevance, setGovRegulatoryRelevance] = useState<string[]>([]);
  const [govAssessmentStatus, setGovAssessmentStatus] = useState("NOT_ASSESSED");
  const [govError, setGovError] = useState("");
  const [govSaving, setGovSaving] = useState(false);

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
      .then((d: AiSystem | null) => {
        if (d) {
          setAiSystem(d);
          setLifecycleDraft(d.lifecycleStatus);
          setGovOwnerUserId(d.ownerUserId ?? "");
          setGovBusinessCriticality(d.businessCriticality ?? "");
          setGovDecisionRole(d.decisionRole ?? "");
          setGovHumanOversight(d.humanOversight ?? "");
          setGovImpactLevel(d.impactLevel ?? "");
          setGovDataSensitivity(d.dataSensitivity ?? "");
          setGovAffectedPopulation(d.affectedPopulation ?? []);
          setGovExternalImpact(d.externalImpact ?? false);
          setGovRegulatoryRelevance(d.regulatoryRelevance ?? []);
          setGovAssessmentStatus(d.assessmentStatus ?? "NOT_ASSESSED");
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
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/tenant-users`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((d) => setTenantUsers(d.users))
      .catch(() => setTenantUsers([]));
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/risk-assessments`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { assessments: [] }))
      .then((d) => setRiskAssessments(d.assessments))
      .catch(() => setRiskAssessments([]));
  }, [id]);

  async function handleStartAssessment() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}/risk-assessments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Risk Assessment - " + new Date().toLocaleDateString() }),
    });
    if (res.ok) {
      const created = await res.json();
      window.location.href = `/ai-risk-assessments/${created.id}`;
    }
  }

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

  function toggleAffectedPopulation(val: string) {
    setGovAffectedPopulation((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
  }
  function toggleRegulatoryRelevance(val: string) {
    setGovRegulatoryRelevance((prev) => (prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]));
  }

  async function handleGovernanceSave() {
    setGovSaving(true);
    setGovError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ai-systems/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerUserId: govOwnerUserId || null,
          businessCriticality: govBusinessCriticality || null,
          decisionRole: govDecisionRole || null,
          humanOversight: govHumanOversight || null,
          impactLevel: govImpactLevel || null,
          dataSensitivity: govDataSensitivity || null,
          affectedPopulation: govAffectedPopulation,
          externalImpact: govExternalImpact,
          regulatoryRelevance: govRegulatoryRelevance,
          assessmentStatus: govAssessmentStatus,
        }),
      });
      if (res.status === 403) {
        setGovError("You don't have permission to edit this AI system's governance profile.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setGovError(body?.error || "Something went wrong saving the governance profile.");
        return;
      }
      loadAiSystem();
    } catch {
      setGovError("Something went wrong saving the governance profile.");
    } finally {
      setGovSaving(false);
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
  const selectStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #2e3d63", background: "#0a0f1a", color: "#e6e9f0", fontSize: 13, width: "100%" };
  const fieldLabelStyle = { fontSize: 13, color: "#8b96ac", display: "block", marginBottom: 4 };
  const helpTextStyle = { fontSize: 11.5, color: "#5d6786", marginTop: 4, marginBottom: 0 };

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
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>Governance</h2>
        <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
          This is the authoritative governance record for this AI system: who is accountable for it, and how it&apos;s classified for oversight purposes.
        </p>

        <label style={fieldLabelStyle}>
          Owner
          <select style={selectStyle} value={govOwnerUserId} onChange={(e) => setGovOwnerUserId(e.target.value)}>
            <option value="">Not assigned</option>
            {tenantUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>
            ))}
          </select>
        </label>
        <p style={helpTextStyle}>The person accountable for this AI system's governance.</p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <label style={fieldLabelStyle}>
            Business Criticality
            <select style={selectStyle} value={govBusinessCriticality} onChange={(e) => setGovBusinessCriticality(e.target.value)}>
              <option value="">Not set</option>
              {BUSINESS_CRITICALITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p style={helpTextStyle}>How important this system is to business operations.</p>
          </label>

          <label style={fieldLabelStyle}>
            Decision Role
            <select style={selectStyle} value={govDecisionRole} onChange={(e) => setGovDecisionRole(e.target.value)}>
              <option value="">Not set</option>
              {DECISION_ROLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p style={helpTextStyle}>{govDecisionRole ? DECISION_ROLE_HELP[govDecisionRole] : "How much authority this system has."}</p>
          </label>

          <label style={fieldLabelStyle}>
            Human Oversight
            <select style={selectStyle} value={govHumanOversight} onChange={(e) => setGovHumanOversight(e.target.value)}>
              <option value="">Not set</option>
              {HUMAN_OVERSIGHT_OPTIONS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
            <p style={helpTextStyle}>Whether a human must review or approve this system's outputs.</p>
          </label>

          <label style={fieldLabelStyle}>
            Impact Level
            <select style={selectStyle} value={govImpactLevel} onChange={(e) => setGovImpactLevel(e.target.value)}>
              <option value="">Not set</option>
              {IMPACT_LEVEL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p style={helpTextStyle}>Potential significance of adverse impact if things go wrong.</p>
          </label>

          <label style={fieldLabelStyle}>
            Data Sensitivity
            <select style={selectStyle} value={govDataSensitivity} onChange={(e) => setGovDataSensitivity(e.target.value)}>
              <option value="">Not set</option>
              {DATA_SENSITIVITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <p style={helpTextStyle}>Highest sensitivity of data this system is expected to process.</p>
          </label>

          <label style={fieldLabelStyle}>
            Assessment Status
            <select style={selectStyle} value={govAssessmentStatus} onChange={(e) => setGovAssessmentStatus(e.target.value)}>
              {ASSESSMENT_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
            </select>
            <p style={helpTextStyle}>Governance assessment status only - not the assessment itself.</p>
          </label>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={fieldLabelStyle}>Affected Population</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {AFFECTED_POPULATION_OPTIONS.map((p) => (
              <label key={p} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8b96ac" }}>
                <input type="checkbox" checked={govAffectedPopulation.includes(p)} onChange={() => toggleAffectedPopulation(p)} />
                {p}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={fieldLabelStyle}>Regulatory Relevance</div>
          <p style={helpTextStyle}>Flags areas for further governance review - not a legal determination.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            {REGULATORY_RELEVANCE_OPTIONS.map((r) => (
              <label key={r} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8b96ac" }}>
                <input type="checkbox" checked={govRegulatoryRelevance.includes(r)} onChange={() => toggleRegulatoryRelevance(r)} />
                {r.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, color: "#8b96ac" }}>
          <input type="checkbox" checked={govExternalImpact} onChange={(e) => setGovExternalImpact(e.target.checked)} />
          This system's outputs or actions can materially affect people outside the organization
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <div style={labelStyle}>Existing Risk Tier</div>
            <div style={valueStyle}>{aiSystem.riskTier || "Not set"}</div>
          </div>
          <div>
            <div style={labelStyle}>Data Categories</div>
            <div style={valueStyle}>{aiSystem.dataCategories.length > 0 ? aiSystem.dataCategories.join(", ") : "None recorded"}</div>
          </div>
        </div>
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

        <button
          onClick={handleGovernanceSave}
          disabled={govSaving}
          style={{
            background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8,
            padding: "10px 18px", fontSize: 13.5, fontWeight: 700,
            cursor: govSaving ? "not-allowed" : "pointer", opacity: govSaving ? 0.6 : 1,
          }}
        >
          {govSaving ? "Saving..." : "Save Governance Profile"}
        </button>
        {govError && (
          <div style={{ background: "#2a1a1a", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", color: "#f87171", fontSize: 12.5, marginTop: 10 }}>
            {govError}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 16 }}>Lifecycle</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
          <select style={{ ...selectStyle, width: "auto" }} value={lifecycleDraft} onChange={(e) => setLifecycleDraft(e.target.value)}>
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
          <select style={{ ...selectStyle, width: "auto" }} value={linkVendorId} onChange={(e) => setLinkVendorId(e.target.value)} required>
            <option value="">Select a vendor...</option>
            {allVendors.map((v) => (
              <option key={v.id} value={v.id}>{v.legalName}</option>
            ))}
          </select>
          <select style={{ ...selectStyle, width: "auto" }} value={linkRole} onChange={(e) => setLinkRole(e.target.value)}>
            {VENDOR_ROLES.map((r) => (
              <option key={r} value={r}>{r.replace(/_/g, " "
    )}</option>
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
    
      <div style={cardStyle}>
        <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 4 }}>AI Risk Assessment</h2>
        <p style={{ color: "#8b96ac", fontSize: 12.5, marginTop: 0, marginBottom: 16 }}>
          Structured risk identification, inherent/residual scoring, controls, treatment, and human review for this AI system.
        </p>
        {riskAssessments === null ? (
          <p style={{ color: "#8b96ac", fontSize: 13 }}>Loading...</p>
        ) : riskAssessments.length === 0 ? (
          <>
            <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 16 }}>No risk assessment has been started yet.</p>
            <button
              onClick={handleStartAssessment}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}
            >
              Start Risk Assessment
            </button>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {riskAssessments.map((a: RiskAssessmentSummary) => {
              const risks = a.risks || [];
              return (
                <a key={a.id} href={`/ai-risk-assessments/${a.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ background: "#0a0f1a", border: "1px solid #233150", borderRadius: 8, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{a.name}</span>
                      <span style={{ fontSize: 11, color: "#8b96ac" }}>{a.status.replace(/_/g, " ")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#8b96ac", marginTop: 6 }}>
                      {risks.length} risk{risks.length === 1 ? "" : "s"} identified
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}