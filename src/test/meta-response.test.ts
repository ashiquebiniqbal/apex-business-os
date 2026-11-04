import { describe, expect, it } from "vitest";
import { INQUIRY_MAX_OUTPUT_TOKENS, conciseRetryInstructions, describeResponseShape, extractRefusalText, extractResponseText, incompleteReason, parseRetryAfterMs, stripJsonFences } from "../../supabase/functions/_shared/meta-response";

describe("extractResponseText", () => {
  it("supports the documented top-level output_text field", () => {
    expect(extractResponseText({ output_text: '{"a":1}' })).toBe('{"a":1}');
  });

  it("supports nested output_text content under any item type", () => {
    const body = { output: [{ type: "message", content: [{ type: "output_text", text: '{"a":1}' }] }] };
    expect(extractResponseText(body)).toBe('{"a":1}');
  });

  it("joins multiple output_text parts", () => {
    const body = { output: [{ type: "reasoning", content: [{ type: "output_text", text: "{" }] }, { type: "message", content: [{ type: "output_text", text: "}" }] }] };
    expect(extractResponseText(body)).toBe("{\n}");
  });

  it("returns null for reasoning-only output without text", () => {
    const body = { status: "completed", output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "thinking" }] }] };
    expect(extractResponseText(body)).toBeNull();
    expect(describeResponseShape(body)).toBe("status=completed; items=reasoning; content=reasoning_text");
  });

  it("returns null for empty output", () => {
    expect(extractResponseText({ status: "completed", output: [] })).toBeNull();
    expect(extractResponseText({})).toBeNull();
  });
});

describe("extractRefusalText", () => {
  it("finds refusal content items", () => {
    const body = { output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot help with that." }] }] };
    expect(extractRefusalText(body)).toBe("I cannot help with that.");
  });

  it("returns null when there is no refusal", () => {
    expect(extractRefusalText({ output_text: "ok" })).toBeNull();
  });
});

describe("stripJsonFences", () => {
  it("strips markdown fences without altering content", () => {
    expect(stripJsonFences('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripJsonFences('```\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(stripJsonFences('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe("incomplete response handling", () => {
  it("uses a bounded output allowance above the old 700-token cap", () => {
    expect(INQUIRY_MAX_OUTPUT_TOKENS).toBeGreaterThan(700);
    expect(INQUIRY_MAX_OUTPUT_TOKENS).toBeLessThanOrEqual(4000);
  });

  it("detects incomplete responses and their reason without parsing partial output", () => {
    expect(incompleteReason({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })).toBe("max_output_tokens");
    expect(incompleteReason({ status: "incomplete" })).toBe("unknown");
    expect(incompleteReason({ status: "completed", output_text: "{}" })).toBeNull();
  });

  it("builds a reduced-output instruction for the single retry", () => {
    const retry = conciseRetryInstructions("Analyze only.");
    expect(retry).toContain("Analyze only.");
    expect(retry).toMatch(/concise/i);
    expect(retry).toMatch(/at most 3/);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delay seconds with an upper bound", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("120")).toBe(30000);
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("nonsense")).toBeNull();
  });
});
