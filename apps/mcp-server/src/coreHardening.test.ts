import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { prisma } from "@vendorguard/database";
import { getSessionFromCookie } from "@vendorguard/auth";
import * as aiClient from "@vendorguard/ai-client";
import type { Role } from "@vendorguard/shared";
import { server } from "./index.js";
import { issueTestSessionCookie } from "./testSession.js";

let url: string,
  tenant: string,
  other: string,
  vendor: string,
  document: string;
const users: Record<string, string> = {},
  controls: Record<string, string> = {},
  frameworks: string[] = [];
async function connect(role: string) {
  const cookie = await issueTestSessionCookie({
    userId: users[role]!,
    tenantId: tenant,
    role,
    email: "mcp@example.com",
    displayName: "Probe",
  });
  const client = new Client(
    { name: "hardening-probe", version: "1" },
    { capabilities: {} },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + "/mcp"), {
      requestInit: { headers: { Cookie: `vg_session=${cookie}` } },
    }),
  );
  return { client, cookie };
}
async function call(role: string, name: string, args: Record<string, string>) {
  const { client } = await connect(role);
  try {
    return await client.callTool({ name, arguments: args });
  } finally {
    await client.close();
  }
}
beforeAll(async () => {
  url = await server.listen({ port: 0, host: "127.0.0.1" });
  tenant = (await prisma.tenant.create({ data: { name: "MCP hardening A" } }))
    .id;
  other = (await prisma.tenant.create({ data: { name: "MCP hardening B" } }))
    .id;
  for (const role of ["ADMIN", "ANALYST", "AUDITOR", "REVIEWER", "READ_ONLY"]) {
    const id = randomUUID();
    users[role] = (
      await prisma.user.create({
        data: { externalId: id, email: `${id}@example.com`, displayName: role },
      })
    ).id;
    await prisma.tenantMembership.create({
      data: { userId: users[role]!, tenantId: tenant, role: role as Role },
    });
  }
  vendor = (
    await prisma.vendor.create({
      data: {
        tenantId: tenant,
        legalName: "MCP evidence probe",
        serviceDescription: "test",
        serviceCategory: "test",
        criticality: "LOW",
      },
    })
  ).id;
  document = (
    await prisma.evidenceDocument.create({
      data: {
        tenantId: tenant,
        vendorId: vendor,
        displayFilename: "MCP RESTRICTED SENTINEL.pdf",
        storageKey: randomUUID(),
        sha256Hash: randomUUID(),
        mimeType: "application/pdf",
        sizeBytes: 10,
        documentType: "Policy",
        uploadedByUserId: users.ANALYST!,
      },
    })
  ).id;
  for (const [label, owner] of [
    ["own", tenant],
    ["foreign", other],
    ["global", null],
  ] as const) {
    const fw = await prisma.framework.create({
      data: {
        catalogId: `s8-test-mcp-hardening-${randomUUID()}`,
        tenantId: owner,
        name: "Visibility fixture",
        scope: "VENDOR_ASSESSMENT",
        industries: [],
      },
    });
    frameworks.push(fw.id);
    const version = await prisma.frameworkVersion.create({
      data: { frameworkId: fw.id, version: "1" },
    });
    controls[label] = (
      await prisma.control.create({
        data: {
          frameworkVersionId: version.id,
          controlId: randomUUID(),
          title: `MCP VISIBILITY ${label}`,
          summary: "Visibility regression",
          domain: "test",
          expectedEvidenceTypes: ["Policy"],
          validationGuidance: "Human decision",
        },
      })
    ).id;
  }
});
afterAll(async () => {
  vi.restoreAllMocks();
  await prisma.evidenceDocument.deleteMany({ where: { tenantId: tenant } });
  await prisma.vendor.deleteMany({ where: { tenantId: tenant } });
  await prisma.auditEvent.deleteMany({ where: { tenantId: tenant } });
  await prisma.framework.deleteMany({ where: { id: { in: frameworks } } });
  await prisma.tenantMembership.deleteMany({ where: { tenantId: tenant } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [tenant, other] } } });
  await server.close();
});
describe("Original MCP private-control and evidence security probes", () => {
  it("denies foreign private get_control", async () => {
    expect(
      (await call("READ_ONLY", "get_control", { controlId: controls.foreign! }))
        .isError,
    ).toBe(true);
  });
  for (const label of ["own", "global"])
    it(`allows ${label} control retrieval`, async () => {
      expect(
        (
          await call("READ_ONLY", "get_control", {
            controlId: controls[label]!,
          })
        ).isError,
      ).not.toBe(true);
    });
  it("filters foreign private search results while retaining own and global controls", async () => {
    const search = await call("READ_ONLY", "search_controls", {
      query: "MCP VISIBILITY",
    });
    expect(JSON.stringify(search)).not.toContain("MCP VISIBILITY foreign");
    expect(JSON.stringify(search)).toContain("MCP VISIBILITY own");
    expect(JSON.stringify(search)).toContain("MCP VISIBILITY global");
  });
  for (const role of ["READ_ONLY", "REVIEWER"])
    it(`denies ${role} evidence metadata and analysis before loading documents`, async () => {
      const originalLookup = prisma.evidenceDocument.findFirst,
        originalList = prisma.evidenceDocument.findMany;
      const lookup = vi.spyOn(prisma.evidenceDocument, "findFirst"),
        list = vi.spyOn(prisma.evidenceDocument, "findMany");
      try {
        expect(
          (await call(role, "get_evidence", { vendorId: vendor })).isError,
        ).toBe(true);
        expect(
          (
            await call(role, "evaluate_evidence", {
              evidenceDocumentId: document,
            })
          ).isError,
        ).toBe(true);
        expect(lookup).not.toHaveBeenCalled();
        expect(list).not.toHaveBeenCalled();
      } finally {
        lookup.mockRestore();
        prisma.evidenceDocument.findFirst = originalLookup;
        list.mockRestore();
        prisma.evidenceDocument.findMany = originalList;
      }
    });
  it("allows auditor metadata but denies auditor analysis", async () => {
    const metadata = await call("AUDITOR", "get_evidence", {
      vendorId: vendor,
    });
    expect(metadata.isError).not.toBe(true);
    expect(JSON.stringify(metadata)).toContain("MCP RESTRICTED SENTINEL.pdf");
    expect(
      (
        await call("AUDITOR", "evaluate_evidence", {
          evidenceDocumentId: document,
        })
      ).isError,
    ).toBe(true);
  });
  for (const role of ["ADMIN", "ANALYST"])
    it(`allows ${role} analysis with no foreign private control in model input`, async () => {
      const analyze = vi.spyOn(aiClient, "analyzeEvidence");
      try {
        expect(
          (
            await call(role, "evaluate_evidence", {
              evidenceDocumentId: document,
            })
          ).isError,
        ).not.toBe(true);
        expect(analyze).toHaveBeenCalledOnce();
        expect(JSON.stringify(analyze.mock.calls)).not.toContain(
          "MCP VISIBILITY foreign",
        );
        expect(JSON.stringify(analyze.mock.calls)).toContain(
          "MCP VISIBILITY own",
        );
        expect(JSON.stringify(analyze.mock.calls)).toContain(
          "MCP VISIBILITY global",
        );
      } finally {
        analyze.mockRestore();
      }
    });
  it("revalidates a durable session on every MCP request and rejects retained-cookie replay after revocation", async () => {
    const { client, cookie } = await connect("ADMIN");
    try {
      expect(
        (
          await client.callTool({
            name: "get_vendor",
            arguments: { vendorId: vendor },
          })
        ).isError,
      ).not.toBe(true);
      await prisma.storedSession.update({
        where: { id: getSessionFromCookie(cookie)!.sessionId! },
        data: { revokedAt: new Date() },
      });
      await expect(
        client.callTool({
          name: "get_vendor",
          arguments: { vendorId: vendor },
        }),
      ).rejects.toBeTruthy();
    } finally {
      await client.close();
    }
  });
});
