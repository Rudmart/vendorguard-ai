import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Alignment Phase A: the product shell must be truthful - every visible destination exists and works.
const webApp = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "src", "app");
const sidebar = readFileSync(join(webApp, "sidebar.tsx"), "utf8");
const hrefs = Array.from(sidebar.matchAll(/href: "([^"]+)"/g)).map((m) => m[1] ?? "");

function pageExists(href: string): boolean {
  return existsSync(join(webApp, href === "/" ? "" : href.slice(1), "page.tsx"));
}

describe("Alignment Phase A - navigation", () => {
  it("every sidebar item points to an existing page", () => {
    expect(hrefs.length).toBeGreaterThanOrEqual(10);
    for (const href of hrefs) {
      expect(pageExists(href), href).toBe(true);
    }
  });

  it("has no placeholders, dead links, fake counts, hardcoded identity or unimplemented capabilities", () => {
    expect(sidebar).not.toMatch(/built: false/);
    expect(hrefs).not.toContain("#");
    expect(hrefs).not.toContain("/evidence");
    expect(sidebar).not.toContain('badge: "3"');
    expect(sidebar).not.toContain("Ruddy A Martinez");
    for (const label of ["AI Incidents", "AI Agents", "Administration", "Vendor Reports", "Third-party risk", "Policies", "Exceptions", "Evidence Library"]) {
      expect(sidebar).not.toContain(`label: "${label}"`);
    }
  });

  it("uses canonical section and item names", () => {
    for (const title of ["Overview", "AI Governance", "AI Risk", "Third-Party AI Risk", "Compliance & Assurance", "Learning Center", "System"]) {
      expect(sidebar).toContain(`title: "${title}"`);
    }
    for (const label of ["Dashboard", "AI Inventory", "AI Use Cases", "Pending Reviews", "Risk Acceptance", "Remediation", "Vendor Inventory", "Vendor Assessments", "Compliance Frameworks", "Audit Logs"]) {
      expect(sidebar).toContain(`label: "${label}"`);
    }
    for (const old of ["Executive Dashboard", "Remediation Tracker", "AI inventory", ">TPRM Workflow<", ">Governance &amp; Reference<"]) {
      expect(sidebar).not.toContain(old);
    }
  });

  it("hides empty sections and keeps learning guides off the missing /evidence page", () => {
    expect(sidebar).toContain(".filter((section) => section.items.length > 0)");
    for (const guide of ["grc-guide", "tprm-guide"]) {
      expect(readFileSync(join(webApp, guide, "page.tsx"), "utf8")).not.toContain('"/evidence"');
    }
  });

  it("top bar shows the signed-in user with sign out", () => {
    const header = readFileSync(join(webApp, "top-header.tsx"), "utf8");
    const menu = readFileSync(join(webApp, "user-menu.tsx"), "utf8");
    expect(header).toContain("<UserMenu />");
    expect(menu).toContain("/auth/me");
    expect(menu).toContain("/auth/logout");
  });
});