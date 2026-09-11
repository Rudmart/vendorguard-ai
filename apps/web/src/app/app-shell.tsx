"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import TopHeader from "./top-header";
import AssistantPanel from "./assistant-panel";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [vendorName, setVendorName] = useState<string | null>(null);
  const pathname = usePathname();

  const vendorMatch = pathname.match(/^\/vendors\/([^/]+)/);
  const vendorId = vendorMatch ? vendorMatch[1] : null;

  useEffect(() => {
    if (!vendorId) {
      setVendorName(null);
      return;
    }
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/vendors/${vendorId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setVendorName(data?.legalName ?? null))
      .catch(() => setVendorName(null));
  }, [vendorId]);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopHeader chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)} />
        {children}
      </div>
      {chatOpen && (
        <AssistantPanel
          isOpen={chatOpen}
          onClose={() => setChatOpen(false)}
          vendorId={vendorId}
          vendorName={vendorName}
        />
      )}
    </div>
  );
}