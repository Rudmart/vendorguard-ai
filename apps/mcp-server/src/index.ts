import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listFrameworks, listControls, getControl, searchControls } from "./frameworks-data.js";

// This MCP server is intentionally read-only. It exposes framework and
// control data for lookup only - it cannot create, modify, or delete
// anything. See docs/threat-model.md for why: OWASP LLM Top 10 defenses
// (tool allowlisting, no destructive model-authored actions) apply here.

const server = new Server(
  { name: "vendorguard-mcp-server", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_frameworks",
        description: "List all compliance/regulatory frameworks available, with how many controls each has.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "list_controls",
        description: "List all controls within a specific framework.",
        inputSchema: {
          type: "object",
          properties: {
            frameworkSlug: {
              type: "string",
              description: "The framework identifier, e.g. 'nist-800-161'",
            },
          },
          required: ["frameworkSlug"],
        },
      },
      {
        name: "get_control",
        description: "Get full details on one specific control within a framework.",
        inputSchema: {
          type: "object",
          properties: {
            frameworkSlug: { type: "string", description: "The framework identifier" },
            controlId: { type: "string", description: "The control ID, e.g. 'C-SCRM-1'" },
          },
          required: ["frameworkSlug", "controlId"],
        },
      },
      {
        name: "search_controls",
        description: "Search for controls matching a text query across all frameworks.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search text, e.g. 'supply chain'" },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "list_frameworks") {
    return { content: [{ type: "text", text: JSON.stringify(listFrameworks(), null, 2) }] };
  }

  if (name === "list_controls") {
    const frameworkSlug = String(args?.frameworkSlug ?? "");
    return { content: [{ type: "text", text: JSON.stringify(listControls(frameworkSlug), null, 2) }] };
  }

  if (name === "get_control") {
    const frameworkSlug = String(args?.frameworkSlug ?? "");
    const controlId = String(args?.controlId ?? "");
    const result = getControl(frameworkSlug, controlId);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  if (name === "search_controls") {
    const query = String(args?.query ?? "");
    return { content: [{ type: "text", text: JSON.stringify(searchControls(query), null, 2) }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("VendorGuard MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
