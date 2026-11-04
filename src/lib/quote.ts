export function calculateQuote(unitPrice: number, taxRate: number, quantity: number) {
  if (![unitPrice, taxRate, quantity].every(Number.isFinite) || unitPrice < 0 || taxRate < 0 || quantity <= 0) {
    throw new Error("Invalid quote inputs");
  }
  const subtotal = round(unitPrice * quantity);
  const taxTotal = round(subtotal * taxRate / 100);
  return { subtotal, taxTotal, total: round(subtotal + taxTotal) };
}

function round(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
