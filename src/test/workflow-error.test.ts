import { describe, expect, it } from "vitest";
import { allowedOrigins, corsHeadersFor } from "../../supabase/functions/_shared/cors";
import { parseNeedsClarification, toWorkflowRequestError } from "../lib/workflow";

describe("edge function CORS origins", () => {
  it("echoes both local dev origins so localhost and 127.0.0.1 both pass preflight", () => {
    const allowed = allowedOrigins(undefined);
    expect(corsHeadersFor("http://localhost:5173", allowed)["Access-Control-Allow-Origin"]).toBe("http://localhost:5173");
    expect(corsHeadersFor("http://127.0.0.1:5173", allowed)["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:5173");
  });

  it("echoes a configured APP_ORIGIN and varies by Origin", () => {
    const allowed = allowedOrigins("https://app.example.com");
    const headers = corsHeadersFor("https://app.example.com", allowed);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(headers["Vary"]).toBe("Origin");
  });

  it("never echoes an unlisted origin", () => {
    const allowed = allowedOrigins(undefined);
    const headers = corsHeadersFor("https://evil.example.com", allowed);
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("https://evil.example.com");
    expect(allowed).toContain(headers["Access-Control-Allow-Origin"]);
  });
});

describe("workflow request errors", () => {
  it("turns a fetch-level failure into an actionable message instead of the raw Supabase text", async () => {
    const fetchError = Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
    const result = await toWorkflowRequestError(fetchError, "Inquiry workflow could not be completed.");
    expect(result.message).not.toBe("Failed to send a request to the Edge Function");
    expect(result.message).toContain("could not reach");
    expect(result.message).toContain("127.0.0.1:5173");
    expect(result.message).toContain("localhost:5173");
  });
});

describe("needs clarification responses", () => {
  const clarificationBody = {
    status: "needs_clarification",
    request_id: "req-409",
    analysis_source: "meta",
    missing_information: ["Several active products match the request (Apex Business Starter (DEMO-APX-001); Apex Operations Suite (DEMO-APX-002)). Narrow the product lookup to exactly one."],
    analysis: { summary: "Wants a quotation", customer_intent: "Request a quotation", business_category: "Software", product_requirements: [{ product_query: "Apex", quantity: 2, unit: "license", constraints: [] }], important_constraints: [], missing_information: [], suggested_next_action: "prepare_proposal" },
  };

  it("returns the structured clarification proposal from an HTTP 409 body", async () => {
    const context = new Response(JSON.stringify(clarificationBody), { status: 409, headers: { "Content-Type": "application/json" } });
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context });
    const result = await parseNeedsClarification(httpError);
    expect(result?.status).toBe("needs_clarification");
    expect(result?.request_id).toBe("req-409");
    expect(result?.missing_information).toEqual(clarificationBody.missing_information);
    expect(result?.analysis?.summary).toBe("Wants a quotation");
  });

  it("ignores non-409 responses, non-clarification bodies, and fetch failures", async () => {
    const wrongStatus = Object.assign(new Error("x"), { name: "FunctionsHttpError", context: new Response(JSON.stringify(clarificationBody), { status: 500 }) });
    expect(await parseNeedsClarification(wrongStatus)).toBeNull();
    const wrongBody = Object.assign(new Error("x"), { name: "FunctionsHttpError", context: new Response(JSON.stringify({ error: "nope" }), { status: 409 }) });
    expect(await parseNeedsClarification(wrongBody)).toBeNull();
    const fetchError = Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" });
    expect(await parseNeedsClarification(fetchError)).toBeNull();
  });
});

describe("workflow server errors", () => {
  it("keeps the server error, detail, request id, and status when the function responded", async () => {
    const context = new Response(JSON.stringify({ error: "Meta analysis timed out", detail: "Retry the request.", request_id: "req-123" }), { status: 504, headers: { "Content-Type": "application/json" } });
    const httpError = Object.assign(new Error("Edge Function returned a non-2xx status code"), { name: "FunctionsHttpError", context });
    const result = await toWorkflowRequestError(httpError, "Inquiry workflow could not be completed.");
    expect(result.message).toBe("Meta analysis timed out Retry the request.");
    expect(result.requestId).toBe("req-123");
    expect(result.status).toBe(504);
  });
});
