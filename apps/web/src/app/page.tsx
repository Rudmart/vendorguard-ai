import AddVendorForm from "./add-vendor-form";
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

export default async function HomePage() {
  const data = await getVendors();
  if (data === null) {
    redirect("/login");
  }
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
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h1 style={{ fontSize: 28, marginBottom: 4 }}>VendorGuard AI</h1>
        <SignOutButton />
      </div>
      <p style={{ color: "#8b96ac", marginBottom: 32 }}>Vendor Inventory</p>

      <AddVendorForm />

      {vendorsWithScores.length === 0 ? (
        <p>No vendors yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {vendorsWithScores.map((vendor: Vendor) => (
            <div
              key={vendor.id}
              style={{
                background: "#111a2b",
                border: "1px solid #233150",
                borderRadius: 10,
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 16 }}>{vendor.legalName}</div>
              <div style={{ color: "#8b96ac", fontSize: 13, marginTop: 4 }}>
                {vendor.serviceDescription} &middot; {vendor.serviceCategory}
              </div>
              <div style={{ color: "#8b96ac", fontSize: 13, marginTop: 4 }}>
                Criticality: {vendor.criticality || "Not set"}
              </div>
              {vendor.risk && (
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "2px 10px",
                      borderRadius: 999,
                      background:
                        vendor.risk.band === "CRITICAL" ? "#7f1d1d" :
                        vendor.risk.band === "HIGH" ? "#7c2d12" :
                        vendor.risk.band === "MODERATE" ? "#78350f" : "#14532d",
                      color:
                        vendor.risk.band === "CRITICAL" ? "#fca5a5" :
                        vendor.risk.band === "HIGH" ? "#fdba74" :
                        vendor.risk.band === "MODERATE" ? "#fcd34d" : "#86efac",
                    }}
                  >
                    {vendor.risk.band}
                  </span>
                  <span style={{ color: "#8b96ac", fontSize: 12 }}>
                    Risk score: {vendor.risk.score}/100
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}



