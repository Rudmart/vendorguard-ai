import AddVendorForm from "./add-vendor-form";
import Link from "next/link";
import SignOutButton from "./sign-out-button";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

async function getVendors() {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error("Failed to fetch vendors");
  }
  return res.json();
}

async function getRiskScore(vendorId: string) {
  const cookieStore = cookies();
  const sessionCookie = cookieStore.get("vg_session");
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/risk-score`, {
    cache: "no-store",
    headers: sessionCookie ? { Cookie: `vg_session=${sessionCookie.value}` } : {},
  });
  if (!res.ok) {
    return null;
  }
  return res.json();
}

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

export default async function HomePage() {
  const data = await getVendors();
  if (data === null) {
    redirect("/login");
  }
  const vendorsWithScores = await Promise.all(
    data.vendors.map(async (vendor: Vendor) => {
      const risk = await getRiskScore(vendor.id);
      return { ...vendor, risk };
    })
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 2 }}>Executive Dashboard</h1>
          <p style={{ color: "#8b96ac", fontSize: 13, margin: 0 }}>
            {vendorsWithScores.length} vendors tracked
          </p>
        </div>
        <SignOutButton />
      </div>

      <input
        type="text"
        placeholder="Search vendors..."
        style={{
          width: "100%",
          background: "#111a2b",
          border: "1px solid #233150",
          borderRadius: 10,
          padding: "12px 16px",
          color: "#e5e9f0",
          fontSize: 14,
          marginBottom: 24,
        }}
      />

      {vendorsWithScores.length === 0 ? (
        <p>No vendors yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
          {vendorsWithScores.map((vendor: Vendor) => (
            <Link key={vendor.id} href={`/vendors/${vendor.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div
                style={{
                  background: "#111a2b",
                  border: "1px solid #233150",
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

      <details>
        <summary style={{ cursor: "pointer", color: "#8b96ac", fontSize: 13, marginBottom: 12 }}>
          + Add a Vendor
        </summary>
        <div style={{ marginTop: 16 }}>
          <AddVendorForm />
        </div>
      </details>
    </main>
  );
}
