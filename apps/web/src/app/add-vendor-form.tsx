"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddVendorForm() {
  const router = useRouter();
  const [legalName, setLegalName] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceCategory, setServiceCategory] = useState("");
  const [criticality, setCriticality] = useState("");
  const [dataSensitivity, setDataSensitivity] = useState("");
  const [businessCriticality, setBusinessCriticality] = useState("");
  const [accessPrivilege, setAccessPrivilege] = useState("");
  const [operationalDependency, setOperationalDependency] = useState("");
  const [fourthPartyConcentration, setFourthPartyConcentration] = useState("");
  const [geographicRegulatoryExposure, setGeographicRegulatoryExposure] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("http://localhost:4000/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName,
          serviceDescription,
          serviceCategory,
          criticality,
          dataSensitivity: dataSensitivity === "" ? undefined : Number(dataSensitivity),
          businessCriticality: businessCriticality === "" ? undefined : Number(businessCriticality),
          accessPrivilege: accessPrivilege === "" ? undefined : Number(accessPrivilege),
          operationalDependency: operationalDependency === "" ? undefined : Number(operationalDependency),
          fourthPartyConcentration: fourthPartyConcentration === "" ? undefined : Number(fourthPartyConcentration),
          geographicRegulatoryExposure: geographicRegulatoryExposure === "" ? undefined : Number(geographicRegulatoryExposure),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create vendor");
      }

      setLegalName("");
      setServiceDescription("");
      setServiceCategory("");
      setCriticality("");
      setDataSensitivity("");
      setBusinessCriticality("");
      setAccessPrivilege("");
      setOperationalDependency("");
      setFourthPartyConcentration("");
      setGeographicRegulatoryExposure("");
      router.refresh();
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

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

  const labelStyle = {
    fontSize: 13,
    color: "#8b96ac",
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: "#111a2b",
        border: "1px solid #233150",
        borderRadius: 10,
        padding: 20,
        marginBottom: 32,
      }}
    >
      <h2 style={{ fontSize: 18, marginTop: 0, marginBottom: 16 }}>Add a Vendor</h2>

      <label style={labelStyle}>
        Vendor Name
        <input
          style={inputStyle}
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          required
        />
      </label>

      <label style={labelStyle}>
        Service Description
        <input
          style={inputStyle}
          value={serviceDescription}
          onChange={(e) => setServiceDescription(e.target.value)}
        />
      </label>

      <label style={labelStyle}>
        Service Category
        <input
          style={inputStyle}
          value={serviceCategory}
          onChange={(e) => setServiceCategory(e.target.value)}
        />
      </label>

      <label style={labelStyle}>
        Criticality
        <select
          style={inputStyle}
          value={criticality}
          onChange={(e) => setCriticality(e.target.value)}
        >
          <option value="">Not set</option>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
      </label>

      <h3 style={{ fontSize: 15, color: "#8b96ac", marginBottom: 4, marginTop: 24 }}>
        Risk Factors (optional, 0-100)
      </h3>
      <p style={{ fontSize: 12, color: "#5c6780", marginTop: 0, marginBottom: 16 }}>
        Leave blank if unknown.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={labelStyle}>
          Data Sensitivity
          <input type="number" min="0" max="100" style={inputStyle} value={dataSensitivity} onChange={(e) => setDataSensitivity(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Business Criticality
          <input type="number" min="0" max="100" style={inputStyle} value={businessCriticality} onChange={(e) => setBusinessCriticality(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Access Privilege
          <input type="number" min="0" max="100" style={inputStyle} value={accessPrivilege} onChange={(e) => setAccessPrivilege(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Operational Dependency
          <input type="number" min="0" max="100" style={inputStyle} value={operationalDependency} onChange={(e) => setOperationalDependency(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Fourth-Party Concentration
          <input type="number" min="0" max="100" style={inputStyle} value={fourthPartyConcentration} onChange={(e) => setFourthPartyConcentration(e.target.value)} />
        </label>
        <label style={labelStyle}>
          Geographic/Regulatory Exposure
          <input type="number" min="0" max="100" style={inputStyle} value={geographicRegulatoryExposure} onChange={(e) => setGeographicRegulatoryExposure(e.target.value)} />
        </label>
      </div>

      {error && <p style={{ color: "#f87171", fontSize: 13 }}>{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        style={{
          background: "#3b82f6",
          color: "white",
          border: "none",
          borderRadius: 8,
          padding: "10px 18px",
          fontSize: 14,
          cursor: submitting ? "not-allowed" : "pointer",
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Adding..." : "Add Vendor"}
      </button>
    </form>
  );
}
