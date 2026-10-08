import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// AI workflow guides (Learning Center): content and link integrity. Reads web source files; no server needed.
const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../../web/src/app");
const read = (rel: string) => fs.readFileSync(path.join(app, rel), "utf8");

const data = read("workflow-guide-data.ts");
const component = read("workflow-guide.tsx");
const govPage = read("grc-guide/page.tsx");
const tprmPage = read("tprm-guide/page.tsx");
const sidebar = read("sidebar.tsx");

function section(name: string): string {
  const start = data.indexOf(`export const ${name}`);
  const end = data.indexOf("];", start);
  return data.slice(start, end);
}
function stages(name: string): string[] {
  return section(name).split("{ n: ").slice(1);
}
function routeExists(href: string): boolean {
  const dir = href === "/" ? app : path.join(app, ...href.split("/").filter(Boolean));
  return fs.existsSync(path.join(dir, "page.tsx"));
}

describe("AI workflow guides - titles and naming", () => {
  it("uses the AI-focused guide titles", () => {
    expect(govPage).toContain('title="AI Governance Workflow Guide"');
    expect(tprmPage).toContain('title="AI TPRM Workflow Guide"');
  });

  it("sidebar Learning Center uses the AI-focused labels and keeps the existing routes", () => {
    expect(sidebar).toContain('label: "AI Governance Workflow", href: "/grc-guide"');
    expect(sidebar).toContain('label: "AI TPRM Workflow", href: "/tprm-guide"');
  });

  it("no generic GRC / TPRM guide naming remains on the guide surfaces", () => {
    for (const text of [govPage, tprmPage, sidebar, component, data]) {
      expect(text).not.toContain("GRC Workflow Guide");
      expect(text).not.toMatch(/(?<!AI )TPRM Workflow Guide/);
    }
  });

  it("reinforces human authority", () => {
    expect(data).toContain('HUMAN_AUTHORITY = "AI ASSISTS. HUMANS GOVERN."');
    expect(component).toContain("{HUMAN_AUTHORITY}");
  });
});

describe("AI workflow guides - stages", () => {
  it("AI Governance guide has 21 numbered stages; AI TPRM guide has 12", () => {
    expect(stages("AI_GOVERNANCE_STAGES")).toHaveLength(21);
    expect(stages("AI_TPRM_STAGES")).toHaveLength(12);
  });

  it("Retirement remains PLANNED; AI Incidents is AVAILABLE", () => {
    const gov = stages("AI_GOVERNANCE_STAGES");
    expect(gov.find(s => s.includes('title: "AI Incident"'))).toContain('status: "AVAILABLE"');
    for (const title of ["Retirement"]) {
      const stage = gov.find((s) => s.includes(`title: "${title}"`));
      expect(stage, title).toBeDefined();
      expect(stage).toContain('status: "PLANNED"');
    }
  });

  it("AI Use Cases V1: Define AI Use Case is AVAILABLE and links to the real AI Use Cases page (20 available, 1 planned)", () => {
    const gov = stages("AI_GOVERNANCE_STAGES");
    const stage = gov.find((s) => s.includes('title: "Define AI Use Case"'));
    expect(stage).toContain('status: "AVAILABLE"');
    expect(stage).toContain('href: "/ai-use-cases"');
    expect(routeExists("/ai-use-cases")).toBe(true);
    expect(gov.filter((s) => s.includes('status: "AVAILABLE"'))).toHaveLength(20);
    expect(gov.filter((s) => s.includes('status: "PLANNED"'))).toHaveLength(1);
  });

  it("every PLANNED stage has no links (no dead links to unbuilt features)", () => {
    for (const s of [...stages("AI_GOVERNANCE_STAGES"), ...stages("AI_TPRM_STAGES")]) {
      if (s.includes('status: "PLANNED"')) {
        expect(s).toContain("links: []");
        expect(s).not.toContain("href:");
      }
    }
  });

  it("every link points to an existing VendorGuard page", () => {
    const hrefs = [...data.matchAll(/href: "([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(hrefs.length).toBeGreaterThan(10);
    for (const href of hrefs) {
      expect(href.startsWith("/"), href).toBe(true);
      expect(href.includes("["), href).toBe(false);
      expect(routeExists(href), href).toBe(true);
    }
  });
});

describe("AI workflow guides - read-only learning surfaces", () => {
  it("introduce no API calls or mutations", () => {
    for (const text of [govPage, tprmPage, component, data]) {
      expect(text).not.toMatch(/fetch\(|method:\s*"(POST|PATCH|PUT|DELETE)"/);
    }
  });

  it("do not describe VendorGuard as a security operations product", () => {
    expect(data).toContain("it is not a SIEM, SOC, EDR, CSPM or runtime AI firewall");
  });
});