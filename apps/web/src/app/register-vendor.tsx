"use client";
import { useState } from "react";

export default function RegisterVendorButton({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ marginBottom: 24 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "#3b82f6",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "11px 20px",
          fontSize: 13.5,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        + Register vendor
      </button>
      {open && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  );
}
