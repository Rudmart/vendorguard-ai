"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteVendorButton({ id }: { id: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this vendor? This cannot be undone from the UI.")) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/");
      router.refresh();
    } catch {
      alert("Something went wrong deleting this vendor.");
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      style={{
        background: "transparent",
        border: "1px solid #7f1d1d",
        color: "#fca5a5",
        borderRadius: 8,
        padding: "6px 14px",
        fontSize: 13,
        cursor: deleting ? "not-allowed" : "pointer",
        opacity: deleting ? 0.6 : 1,
      }}
    >
      {deleting ? "Deleting..." : "Delete Vendor"}
    </button>
  );
}
