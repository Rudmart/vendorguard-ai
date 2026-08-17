"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Evidence = {
  id: string;
  displayFilename: string;
  documentType: string;
  state: string;
  expirationDate: string | null;
  createdAt: string;
};

export default function EvidenceLibraryPage() {
  const params = useParams();
  const vendorId = params.id as string;
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [filename, setFilename] = useState("");
  const [docType, setDocType] = useState("");
  const [expiration, setExpiration] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/evidence`, {
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      setEvidence(data.evidence);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [vendorId]);

  async function handleAdd() {
    if (!filename || !docType) return;
    setSubmitting(true);
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}/evidence`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayFilename: filename,
        documentType: docType,
        expirationDate: expiration || null,
      }),
    });
    setFilename("");
    setDocType("");
    setExpiration("");
    await load();
    setSubmitting(false);
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Evidence Library</h1>
      <p style={{ color: "#8b96ac", fontSize: 13, marginBottom: 24 }}>
        {evidence.length} documents on record
      </p>

      <div
        style={{
          background: "#1a2340",
          border: "1px solid #2e3d63",
          borderRadius: 10,
          padding: 18,
          marginBottom: 24,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Add Evidence</div>
        <input
          placeholder="Filename (e.g. SOC2-Report-2026.pdf)"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          style={{ width: "100%", background: "#141b2d", border: "1px solid #2e3d63", borderRadius: 8, padding: "8px 12px", color: "#e5e9f0", fontSize: 13, marginBottom: 10 }}
        />
        <input
          placeholder="Document type (e.g. SOC 2 report)"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          style={{ width: "100%", background: "#141b2d", border: "1px solid #2e3d63", borderRadius: 8, padding: "8px 12px", color: "#e5e9f0", fontSize: 13, marginBottom: 10 }}
        />
        <input
          type="date"
          placeholder="Expiration date (optional)"
          value={expiration}
          onChange={(e) => setExpiration(e.target.value)}
          style={{ width: "100%", background: "#141b2d", border: "1px solid #2e3d63", borderRadius: 8, padding: "8px 12px", color: "#e5e9f0", fontSize: 13, marginBottom: 12 }}
        />
        <button
          onClick={handleAdd}
          disabled={submitting}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 700,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting ? "Adding..." : "Add Evidence"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: "#8b96ac" }}>Loading...</p>
      ) : evidence.length === 0 ? (
        <p style={{ color: "#8b96ac" }}>No evidence on record yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {evidence.map((e) => (
            <div
              key={e.id}
              style={{
                background: "#1a2340",
                border: "1px solid #2e3d63",
                borderRadius: 10,
                padding: "14px 18px",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14 }}>{e.displayFilename}</div>
              <div style={{ color: "#8b96ac", fontSize: 12, marginTop: 4 }}>
                {e.documentType} &middot; {e.state}
                {e.expirationDate && ` \u00b7 Expires ${new Date(e.expirationDate).toLocaleDateString()}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
