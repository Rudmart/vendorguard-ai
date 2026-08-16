import AddVendorForm from "./add-vendor-form";
import RegisterVendorButton from "./register-vendor";
import SignOutButton from "./sign-out-button";
import VendorList from "./vendor-list";
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

      <RegisterVendorButton><AddVendorForm /></RegisterVendorButton>
      <VendorList vendors={vendorsWithScores} />

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



