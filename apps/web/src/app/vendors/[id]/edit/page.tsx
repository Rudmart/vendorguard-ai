"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

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

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #233150",
  background: "#0a0f1a",
  color: "#e9edf6",
  fontSize: 14,
  marginTop: 4,
  marginBottom: 16,
};

const labelStyle = { fontSize: 13, color: "#8b96ac" };

export default function EditVendorPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load vendor");
        return res.json();
      })
      .then((data) => {
        setVendor(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load vendor.");
        setLoading(false);
      });
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendor) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          legalName: vendor.legalName,
          serviceDescription: vendor.serviceDescription,
          serviceCategory: vendor.serviceCategory,
          criticality: vendor.criticality,
          dataSensitivity: vendor.dataSensitivity,
          businessCriticality: vendor.businessCriticality,
          accessPrivilege: vendor.accessPrivilege,
          operationalDependency: vendor.operationalDependency,
          fourthPartyConcentration: vendor.fourthPartyConcentration,
          geographicRegulatoryExposure: vendor.geographicRegulatoryExposure,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      router.push(`/vendors/${id}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main style={{ maxWidth: 700, margin: "80px auto", padding: "0 20px" }}>Loading...</main>;
  }
  if (!vendor) {
    return <main style={{ maxWidth: 700, margin: "80px auto", padding: "0 20px" }}>Vendor not found.</main>;
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "40px 20px" }}>
      <Link href={`/vendors/${id}`} style={{ color: "#8b96ac", fontSize: 13, textDecoration: "none" }}>
        Cancel
      </Link>
      <h1 style={{ fontSize: 26, margin: "16px 0 24px 0" }}>Edit Vendor</h1>

      <form onSubmit={handleSubmit} style={{ background: "#111a2b", border: "1px solid #233150", borderRadius: 10, padding: 24 }}>
        <label style={labelStyle}>
          Vendor Name
          <input
            style={inputStyle}
            value={vendor.legalName}
            onChange={(e) => setVendor({ ...vendor, legalName: e.target.value })}
            required
          />
        </label>

        <label style={labelStyle}>
          Service Description
          <input
            style={inputStyle}
            value={vendor.serviceDescription}
            onChange={(e) => setVendor({ ...vendor, serviceDescription: e.target.value })}
          />
        </label>

        <label style={labelStyle}>
          Service Category
          <input
            style={inputStyle}
            value={vendor.serviceCategory}
            onChange={(e) => setVendor({ ...vendor, serviceCategory: e.target.value })}
          />
        </label>

        {error && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 16 }}>{error}</p>}

        <button
          type="submit"
          disabled={saving}
          style={{
            background: "#3b82f6",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 14,
            cursor: saving ? "not-allowed" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </main>
  );
}
