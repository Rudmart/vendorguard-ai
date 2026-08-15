import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

type VendorRisk = {
  band: string;
  score: number;
};

type Vendor = {
  id: string;
  legalName: string;
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

export default async function VendorInventoryPage() {
  const data = await getVendors();
  if (data === null) {
    redirect("/login");
  }
  const vendorsWithScores: Vendor[] = await Promise.all(
    data.vendors.map(async (vendor: Vendor) => {
      const risk = await getRiskScore(vendor.id);
      return { ...vendor, risk };
    })
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 2 }}>Vendor Inventory</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {vendorsWithScores.length} vendors on record
      </p>

      <div
        style={{
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1.2fr 1fr 1.2fr",
            padding: "12px 20px",
            fontSize: 11.5,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            color: "#5d6786",
            borderBottom: "1px solid #2e3d63",
          }}
        >
          <div>Vendor</div>
          <div>Category</div>
          <div>Criticality</div>
          <div>Risk</div>
        </div>

        {vendorsWithScores.length === 0 ? (
          <div style={{ padding: 20, color: "#8b96ac" }}>No vendors yet.</div>
        ) : (
          vendorsWithScores.map((vendor) => (
            <Link
              key={vendor.id}
              href={`/vendors/${vendor.id}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1.2fr 1fr 1.2fr",
                  padding: "14px 20px",
                  fontSize: 13.5,
                  borderBottom: "1px solid #2e3d63",
                  alignItems: "center",
                }}
              >
                <div style={{ fontWeight: 600 }}>{vendor.legalName}</div>
                <div style={{ color: "#8b96ac" }}>{vendor.serviceCategory}</div>
                <div style={{ color: "#8b96ac" }}>{vendor.criticality || "Not set"}</div>
                <div>
                  {vendor.risk ? (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: riskColor(vendor.risk.band),
                        border: `1px solid ${riskColor(vendor.risk.band)}`,
                        borderRadius: 999,
                        padding: "2px 10px",
                      }}
                    >
                      {vendor.risk.band} &middot; {vendor.risk.score}/100
                    </span>
                  ) : (
                    <span style={{ color: "#5d6786", fontSize: 12 }}>No data</span>
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
