import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { prisma } from "./client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRAMEWORKS_DIR = join(__dirname, "..", "..", "..", "frameworks");

async function seedFrameworks() {
  const dirs = readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const dir of dirs) {
    let raw: string;
    try {
      raw = readFileSync(join(FRAMEWORKS_DIR, dir, "controls.json"), "utf-8");
    } catch {
      console.log(`Skipping ${dir} - no controls.json`);
      continue;
    }
    const data = JSON.parse(raw);

    const framework = await prisma.framework.upsert({
      where: { catalogId: data.frameworkId },
      update: { name: data.frameworkName, industries: ["GENERAL"] },
      create: {
        catalogId: data.frameworkId,
        tenantId: null,
        name: data.frameworkName,
        scope: "VENDOR_ASSESSMENT",
        industries: ["GENERAL"],
      },
    });

    const frameworkVersion = await prisma.frameworkVersion.upsert({
      where: { frameworkId_version: { frameworkId: framework.id, version: data.version } },
      update: { sourceUrl: data.sourceUrl ?? null, licenseNote: data.licenseNote ?? null, isCurrent: true },
      create: {
        frameworkId: framework.id,
        version: data.version,
        sourceUrl: data.sourceUrl ?? null,
        licenseNote: data.licenseNote ?? null,
        isCurrent: true,
      },
    });

    for (const control of data.controls) {
      await prisma.control.upsert({
        where: {
          frameworkVersionId_controlId: {
            frameworkVersionId: frameworkVersion.id,
            controlId: control.controlId,
          },
        },
        update: {
          title: control.title,
          summary: control.summary,
          domain: control.domain,
          expectedEvidenceTypes: control.expectedEvidenceTypes ?? [],
          validationGuidance: control.validationGuidance ?? "",
        },
        create: {
          frameworkVersionId: frameworkVersion.id,
          controlId: control.controlId,
          title: control.title,
          summary: control.summary,
          domain: control.domain,
          expectedEvidenceTypes: control.expectedEvidenceTypes ?? [],
          validationGuidance: control.validationGuidance ?? "",
        },
      });
    }

    console.log(`Seeded ${dir}: ${data.controls.length} controls`);
  }
}

seedFrameworks()
  .then(() => {
    console.log("Framework seeding complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
