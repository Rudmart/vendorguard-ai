"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  built: boolean;
  icon: string;
  badge?: string;
};

const overviewItems: NavItem[] = [
  { label: "Executive dashboard", href: "/", built: true, icon: "\u2637" },
  { label: "Third-party risk", href: "/third-party-risk", built: false, icon: "\uD83D\uDEE1" },
  { label: "Vendor inventory", href: "/vendors-list", built: true, icon: "\uD83C\uDFE2" },
  { label: "Vendor detail", href: "/vendors", built: true, icon: "\uD83D\uDC64" },
];

const assessmentItems: NavItem[] = [
  { label: "Assessment workspace", href: "/assessments", built: true, icon: "\u2705" },
  { label: "Evidence library", href: "/evidence", built: true, icon: "\uD83D\uDCC4", badge: "3" },
  { label: "AI inventory", href: "/ai-inventory", built: true, icon: "\u2728" },
  { label: "AI assistant", href: "/ai-assistant", built: false, icon: "\u2728" },
  { label: "Framework explorer", href: "/frameworks", built: true, icon: "\uD83D\uDCD8" },
  { label: "Remediation tracker", href: "/remediation", built: true, icon: "\u2705", badge: undefined },
];

const governanceItems: NavItem[] = [
  { label: "Reports", href: "/reports", built: false, icon: "\uD83D\uDCC8" },
  { label: "Audit log", href: "/audit-log", built: false, icon: "\uD83D\uDCC4" },
  { label: "Administration", href: "/administration", built: false, icon: "\u2699" },
];

const styles = {
  sidebar: {
    width: 240,
    background: "#1a2340",
    borderRight: "1px solid #2e3d63",
    padding: "20px 12px",
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    position: "sticky" as const,
    top: 0,
    flexShrink: 0,
  },
  brandRow: { display: "flex", gap: 10, alignItems: "flex-start", padding: "4px 8px 20px 8px" },
  brandIcon: {
    width: 34, height: 34, borderRadius: 8, background: "#3b82f6",
    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0,
  },
  brandName: { fontSize: 14.5, fontWeight: 700 },
  brandTag: { fontSize: 9.5, color: "#5d6786", letterSpacing: 0.3 },
  sectionLabel: {
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#5d6786",
    fontWeight: 600,
    padding: "16px 10px 6px 10px",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13.5,
    color: "#8b96ac",
    marginBottom: 2,
  },
  itemActive: { background: "rgba(59,130,246,0.14)", color: "#3b82f6" },
  navIcon: { width: 16, textAlign: "center" as const, flexShrink: 0 },
  badge: {
    fontSize: 10,
    color: "#5d6786",
    border: "1px solid #2e3d63",
    borderRadius: 4,
    padding: "1px 5px",
    marginLeft: "auto",
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "#ef4444",
    marginLeft: "auto",
  },
  footer: {
    marginTop: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 10px",
    borderTop: "1px solid #2e3d63",
  },
  avatar: {
    width: 30, height: 30, borderRadius: 999, background: "#3b82f6",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11.5, fontWeight: 700, color: "#fff", flexShrink: 0,
  },
  footerName: { fontSize: 12.5, fontWeight: 600 },
  footerRole: { fontSize: 10.5, color: "#5d6786" },
};

function NavSection({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.built ? item.href : "#"}
            style={{
              ...styles.item,
              ...(isActive ? styles.itemActive : {}),
              cursor: item.built ? "pointer" : "default",
              textDecoration: "none",
            }}
          >
            <span style={styles.navIcon}>{item.icon}</span>
            <span>{item.label}</span>
            {item.badge && (
              <span style={/[0-9]/.test(item.badge) ? styles.countBadge : styles.badge}>
                {item.badge}
              </span>
            )}
            {!item.built && !item.badge && <span style={styles.badge}>soon</span>}
          </Link>
        );
      })}
    </>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [remediationBadge, setRemediationBadge] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/remediations`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.remediations)) {
          const openCount = data.remediations.filter((i: { status: string }) => i.status !== "CLOSED").length;
          setRemediationBadge(openCount > 0 ? String(openCount) : undefined);
        }
      })
      .catch(() => {});
  }, []);
  if (pathname === "/login") return null;

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brandRow}>
        <div style={styles.brandIcon}>{"\uD83D\uDEE1"}</div>
        <div>
          <div style={styles.brandName}>VendorGuard</div>
          <div style={styles.brandTag}>BANKING &middot; HEALTHCARE &middot; TPRM</div>
        </div>
      </div>

      <div style={styles.sectionLabel}>Overview</div>
      <NavSection items={overviewItems} pathname={pathname} />

      <div style={styles.sectionLabel}>Assessment</div>
      <NavSection items={assessmentItems.map((item) => item.label === "Remediation tracker" ? { ...item, badge: undefined } : item)} pathname={pathname} />

      <div style={styles.sectionLabel}>Governance</div>
      <NavSection items={governanceItems} pathname={pathname} />

      <div style={styles.footer}>
        <div style={styles.avatar}>RM</div>
        <div>
          <div style={styles.footerName}>Ruddy A Martinez</div>
          <div style={styles.footerRole}>NEXAIGLOBAL</div>
        </div>
      </div>
    </aside>
  );
}


