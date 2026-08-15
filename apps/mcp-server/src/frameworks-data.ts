import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, "..", "..", "..", "frameworks");

export type Control = {
  controlId: string;
  title: string;
  summary?: string;
  [key: string]: unknown;
};

export type FrameworkInfo = {
  slug: string;
  controlCount: number;
};

function loadControlsForFramework(slug: string): Control[] {
  const filePath = join(FRAMEWORKS_DIR, slug, "controls.json");
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : (parsed.controls ?? []);
  } catch {
    return [];
  }
}

export function listFrameworks(): FrameworkInfo[] {
  const entries = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true });
  const frameworks: FrameworkInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const controls = loadControlsForFramework(entry.name);
    if (controls.length > 0) {
      frameworks.push({ slug: entry.name, controlCount: controls.length });
    }
  }
  return frameworks;
}

export function listControls(frameworkSlug: string): Control[] {
  return loadControlsForFramework(frameworkSlug);
}

export function getControl(frameworkSlug: string, controlId: string): Control | null {
  const controls = loadControlsForFramework(frameworkSlug);
  return controls.find((c) => c.controlId === controlId) ?? null;
}

export function searchControls(query: string): Array<Control & { framework: string }> {
  const frameworks = listFrameworks();
  const results: Array<Control & { framework: string }> = [];
  const lowerQuery = query.toLowerCase();
  for (const fw of frameworks) {
    const controls = loadControlsForFramework(fw.slug);
    for (const control of controls) {
      const haystack = `${control.controlId} ${control.title} ${control.summary ?? ""}`.toLowerCase();
      if (haystack.includes(lowerQuery)) {
        results.push({ ...control, framework: fw.slug });
      }
    }
  }
  return results;
}



