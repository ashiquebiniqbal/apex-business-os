import { describe, expect, it } from "vitest";
import { calculateQuote } from "../lib/quote";

describe("calculateQuote", () => {
  it("calculates deterministic subtotal, tax, and total", () => {
    expect(calculateQuote(28000, 15, 2)).toEqual({ subtotal: 56000, taxTotal: 8400, total: 64400 });
  });

  it("rejects invalid quantities", () => {
    expect(() => calculateQuote(100, 5, 0)).toThrow("Invalid quote inputs");
  });
});
