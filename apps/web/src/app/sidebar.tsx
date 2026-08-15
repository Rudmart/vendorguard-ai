"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  built: boolean;
};

const overviewItems: NavItem[] = [
  { label: "Executive dashboard", href: "/", built: true },
  { label: "Vendor inventory", href: "/vendors-list", built: true },
];

const assessmentItems: NavItem[] = [
  { label: "Assessment", href: "/assessment", built: false },
  { label: "Evidence library", href: "/evidence", built: false },
];

const governanceItems: NavItem[] = [
  { label: "Framework explorer", href: "/frameworks", built: false },
  { label: "Remediation tracker", href: "/remediation", built: false },
  { label: "Reports", href: "/reports", built: false },
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
  brand: { fontSize: 16, fontWeight: 700, padding: "4px 10px 20px 10px" },
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
    justifyContent: "space-between",
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13.5,
    color: "#8b96ac",
    marginBottom: 2,
  },
  itemActive: { background: "rgba(59,130,246,0.14)", color: "#3b82f6" },
  badge: {
    fontSize: 10,
    color: "#5d6786",
    border: "1px solid #233150",
    borderRadius: 4,
    padding: "1px 5px",
  },
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
            }}
          >
            <span>{item.label}</span>
            {!item.built && <span style={styles.badge}>soon</span>}
          </Link>
        );
      })}
    </>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>VendorGuard AI</div>

      <div style={styles.sectionLabel}>Overview</div>
      <NavSection items={overviewItems} pathname={pathname} />

      <div style={styles.sectionLabel}>Assessment</div>
      <NavSection items={assessmentItems} pathname={pathname} />

      <div style={styles.sectionLabel}>Governance</div>
      <NavSection items={governanceItems} pathname={pathname} />
    </aside>
  );
}


