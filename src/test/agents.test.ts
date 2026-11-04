import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, checkQuotationProposal, getAgent, planAgents } from "../lib/agents";
import { TOOL_REGISTRY, executeTool } from "../lib/agent-tools";
import { validateIntegration, validateProviderRegistration } from "../lib/providers";

const ctx = { orgId: "org-1", role: "owner", currency: "USD" };

describe("agent registry", () => {
  it("registers all ten selectable agents with permissions and tool boundaries", () => {
    expect(AGENT_REGISTRY.map((agent) => agent.id)).toEqual(["orchestrator", "worker", "sales", "finance", "operations", "quality", "admin", "writer", "marketing", "reporter"]);
    for (const agent of AGENT_REGISTRY) {
      expect(agent.allowedTools.length).toBeGreaterThan(0);
      expect(agent.restrictedTools.length).toBeGreaterThan(0);
      expect(agent.systemInstructions.length).toBeGreaterThan(10);
      expect(agent.status).toBe("ready");
    }
    expect(getAgent("finance").allowedTools).toContain("quotations.create");
    expect(getAgent("writer").restrictedTools).toContain("external.send");
  });
});

describe("orchestrator planning", () => {
  it("routes the acceptance request to the five-agent pipeline", () => {
    expect(planAgents("Review pending inquiries, identify relevant products, prepare quotations, check the calculations and show me the proposals for approval.", "auto")).toEqual(["sales", "operations", "finance", "quality", "reporter"]);
  });
  it("honours a direct agent selection and routes specialist keywords", () => {
    expect(planAgents("anything", "finance")).toEqual(["finance"]);
    expect(planAgents("show me a summary of overdue tasks", "auto")).toContain("reporter");
    expect(planAgents("draft an email to a customer", "auto")).toContain("writer");
  });
});

describe("quality checker", () => {
  it("passes a fully recorded proposal and fails invented or missing prices", () => {
    expect(checkQuotationProposal({ productName: "Widget", unitPrice: 100, taxRate: 10, quantity: 2, currency: "USD", customerLinked: true }).verdict).toBe("PASS");
    expect(checkQuotationProposal({ productName: null, unitPrice: null, quantity: 1, currency: "USD", customerLinked: false }).verdict).toBe("FAIL");
    expect(checkQuotationProposal({ productName: "Widget", unitPrice: 100, taxRate: 0, quantity: 1, currency: "EUR", customerLinked: false }).verdict).toBe("WARNING");
  });
});

describe("tool registry gates", () => {
  it("implements at least the required typed tools with categories", () => {
    const ids = TOOL_REGISTRY.map((tool) => tool.id);
    for (const required of ["customers.search", "products.search", "suppliers.search", "inquiries.search", "quotations.create", "quotations.add_line", "opportunities.search", "tasks.create", "reports.get_summary", "organization.get_settings"]) expect(ids).toContain(required);
    expect(TOOL_REGISTRY.find((tool) => tool.id === "quotations.create")?.category).toBe("high");
    expect(TOOL_REGISTRY.find((tool) => tool.id === "reports.get_summary")?.category).toBe("read");
  });
  it("blocks high-impact writes without approval and unknown tools", async () => {
    const blocked = await executeTool(ctx, "quotations.create", { inquiry_id: "i1" });
    expect(blocked.ok).toBe(false);
    expect(blocked.requiresApproval).toBe(true);
    expect((await executeTool(ctx, "nope.tool", {})).error).toBe("unknown_tool");
  });
  it("blocks writes for viewer roles before touching the database", async () => {
    const result = await executeTool({ ...ctx, role: "viewer" }, "customers.create", { name: "Acme" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("permission_denied");
  });
});

describe("provider and integration registration safety", () => {
  it("accepts secret references and rejects pasted keys or insecure endpoints", () => {
    expect(validateProviderRegistration({ id: "1", name: "OpenAI", kind: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-example", credentialRef: "OPENAI_COMPATIBLE_API_KEY", enabled: true })).toEqual([]);
    const pasted = validateProviderRegistration({ id: "1", name: "OpenAI", kind: "openai-compatible", baseUrl: "http://example.com/v1", model: "", credentialRef: "sk-live-secret-value", enabled: true });
    expect(pasted.length).toBeGreaterThanOrEqual(2);
    expect(validateIntegration({ id: "1", name: "CRM", kind: "mcp-http", endpoint: "https://example.com/mcp", authType: "bearer-credential-ref", credentialRef: "CRM_API_KEY", description: "", operations: "", enabled: true, approvedTools: "" })).toEqual([]);
  });
});
