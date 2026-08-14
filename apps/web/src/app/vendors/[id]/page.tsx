import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";

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
  dataSensitivity: number | null;
  businessCriticality: number | null;
  accessPrivilege: number | null;
  operationalDependency: number | null;
  fourthPartyConcentration: number | null;
  geographicRegulatoryExposure: number | null;
};

async function getVendor(id: string) {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (res.status === 404) {
    return null;
  }
  if (res.status === 401) {
    redirect("/login");
  }
  if (!res.ok) {
    throw new Error("Failed to fetch vendor");
  }
  return res.json();
}

async function getRiskScore(id: string) {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}/risk-score`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (!res.ok) {
    return null;
  }
  return res.json();
}

export default async function VendorDetailPage({ params }: { params: { id: string } }) {
  const vendor: Vendor | null = await getVendor(params.id);
  if (!vendor) {
    notFound();
  }
  const risk: VendorRisk | null = await getRiskScore(params.id);

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "40px 20px" }}>
      <Link href="/" style={{ color: "#8b96ac", fontSize: 13, textDecoration: "none" }}>
        Back to vendors
      </Link>

      <div style={{ marginTop: 16 }}>
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>{vendor.legalName}</h1>
      </div>

      {risk && (
        <div style={{ marginTop: 8, marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "3px 12px",
              borderRadius: 999,
              background:
                risk.band === "CRITICAL" ? "#7f1d1d" :
                risk.band === "HIGH" ? "#7c2d12" :
                risk.band === "MODERATE" ? "#78350f" : "#14532d",
              color:
                risk.band === "CRITICAL" ? "#fca5a5" :
                risk.band === "HIGH" ? "#fdba74" :
                risk.band === "MODERATE" ? "#fcd34d" : "#86efac",
            }}
          >
            {risk.band}
          </span>
          <span style={{ color: "#8b96ac", fontSize: 13 }}>Risk score: {risk.score}/100</span>
        </div>
      )}

      <div style={{ background: "#111a2b", border: "1px solid #233150", borderRadius: 10, padding: 24 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#8b96ac", fontSize: 12 }}>Service Description</div>
          <div style={{ fontSize: 15 }}>{vendor.serviceDescription || "Not set"}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#8b96ac", fontSize: 12 }}>Service Category</div>
          <div style={{ fontSize: 15 }}>{vendor.serviceCategory || "Not set"}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: "#8b96ac", fontSize: 12 }}>Criticality</div>
          <div style={{ fontSize: 15 }}>{vendor.criticality || "Not set"}</div>
        </div>
      </div>
    </main>
  );
}
