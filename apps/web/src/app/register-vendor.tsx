"use client";
import { useState } from "react";
import { useCurrentUser } from "./current-user";

function RegisterVendorButtonUnguarded({ children }: { children: React.ReactNode }) {
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

// D3b: creating an AI vendor requires vendor:create (UX only - POST /vendors enforces it server-side).
export default function RegisterVendorButton(props: Parameters<typeof RegisterVendorButtonUnguarded>[0]) {
  const { can } = useCurrentUser();
  return can("vendor:create") ? <RegisterVendorButtonUnguarded {...props} /> : null;
}
