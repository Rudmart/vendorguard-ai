"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import SignOutButton from "./sign-out-button";

type NavItem = {
  label: string;
  href: string;
  built: boolean;
  icon: string;
  badge?: string;
  color?: string;
};

type NavSectionDef = { title: string; items: NavItem[] };

// Canonical Master Plan sections, showing ONLY pages that exist and work today.
// Unimplemented capabilities are not shown (no "soon", no "#", no placeholders); empty sections are hidden.
const navSections: NavSectionDef[] = [
  { title: "Overview", items: [{ label: "Dashboard", href: "/", built: true, icon: "\u2637" }, { label: "My Work", href: "/my-work", built: true, icon: "\uD83D\uDDC2" }] },
  {
    title: "AI Governance",
    items: [
      { label: "AI Inventory", href: "/ai-inventory", built: true, icon: "\u2728" },
      { label: "Pending Reviews", href: "/reviews/pending", built: true, icon: "\u2611" },
    ],
  },
  {
    title: "AI Risk",
    items: [
      { label: "Risk Register", href: "/risk-register", built: true, icon: "\uD83D\uDCCB" },
      { label: "Risk Assessments", href: "/risk-assessments", built: true, icon: "\uD83D\uDCCA" },
      { label: "Impact Assessments", href: "/impact-assessments", built: true, icon: "\uD83C\uDFAF" },
      { label: "Findings", href: "/findings", built: true, icon: "\u26A0" },
      { label: "Risk Acceptance", href: "/risk-acceptance", built: true, icon: "\u2696" },
      { label: "Remediation", href: "/remediation", built: true, icon: "\u2705" },
    ],
  },
  {
    title: "Third-Party AI Risk",
    items: [
      { label: "Vendor Inventory", href: "/vendors-list", built: true, icon: "\uD83C\uDFE2" },
      { label: "Vendor Assessments", href: "/assessments", built: true, icon: "\u2705" },
    ],
  },
  { title: "Compliance & Assurance", items: [{ label: "Compliance Frameworks", href: "/frameworks", built: true, icon: "\uD83D\uDCD8" }] },
  {
    title: "Monitoring",
    items: [
      { label: "Governance Monitoring", href: "/governance-monitoring", built: true, icon: "\uD83D\uDCE1" },
      { label: "Reassessments", href: "/reassessments", built: true, icon: "\uD83D\uDD04" },
    ],
  },
  { title: "Reporting", items: [] },
  {
    title: "Learning Center",
    items: [
      { label: "GRC Workflow Guide", href: "/grc-guide", built: true, icon: "\uD83C\uDF93", color: "#86efac" },
      { label: "TPRM Workflow Guide", href: "/tprm-guide", built: true, icon: "\uD83D\uDCDA", color: "#86efac" },
    ],
  },
  { title: "System", items: [{ label: "Audit Logs", href: "/audit-log", built: true, icon: "\uD83D\uDCC4" }] },
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
    overflowY: "auto" as const,
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
  sectionLabelFirst: {
    fontSize: 11.5,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#86efac",
    fontWeight: 700,
    padding: "4px 10px 6px 10px",
  },
  sectionLabel: {
    fontSize: 11.5,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    color: "#86efac",
    fontWeight: 700,
    padding: "16px 10px 6px 10px",
    marginTop: 6,
    borderTop: "1px solid #2e3d63",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    fontSize: 13.5,
    color: "#c7cee2",
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
              ...(item.color ? { color: item.color } : {}),
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
          <div style={styles.brandTag}>AI GOVERNANCE &middot; RISK &middot; ASSURANCE</div>
        </div>
      </div>

      {navSections
        .filter((section) => section.items.length > 0)
        .map((section, index) => (
          <div key={section.title}>
            <div style={index === 0 ? styles.sectionLabelFirst : styles.sectionLabel}>{section.title}</div>
            <NavSection
              items={section.items.map((item) => (item.href === "/remediation" ? { ...item, badge: remediationBadge } : item))}
              pathname={pathname}
            />
          </div>
        ))}
      <div style={styles.footer}>
        <SignOutButton />
      </div>
    </aside>
  );
}
