import AddVendorForm from "./add-vendor-form";

async function getVendors() {
  const res = await fetch("http://localhost:4000/vendors", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Failed to fetch vendors");
  }
  return res.json();
}

export default async function HomePage() {
  const data = await getVendors();

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 20px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>VendorGuard AI</h1>
      <p style={{ color: "#8b96ac", marginBottom: 32 }}>Vendor Inventory</p>

      <AddVendorForm />

      {data.vendors.length === 0 ? (
        <p>No vendors yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.vendors.map((vendor: any) => (
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
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
