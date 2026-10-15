/**
 * Paper account for one arm on one asset. All-in or all-out.
 * Money is kept in the asset's quote currency (USD for BTC/XAU, THB for USD/THB);
 * reporting converts to THB with the rate locked at the start of the count.
 */
export interface Ledger {
  cash: number;
  units: number;
  /** Cost per side as a fraction, e.g. 0.0015 for 0.15%. */
  costRate: number;
  feesPaid: number;
}

export function newLedger(startCash: number, costRate: number): Ledger {
  return { cash: startCash, units: 0, costRate, feesPaid: 0 };
}

export function isHolding(l: Ledger): boolean {
  return l.units > 0;
}

export function buyAll(l: Ledger, price: number): Ledger {
  if (isHolding(l) || l.cash <= 0) return l;
  const fee = l.cash * l.costRate;
  return { ...l, units: (l.cash - fee) / price, cash: 0, feesPaid: l.feesPaid + fee };
}

export function sellAll(l: Ledger, price: number): Ledger {
  if (!isHolding(l)) return l;
  const gross = l.units * price;
  const fee = gross * l.costRate;
  return { ...l, cash: gross - fee, units: 0, feesPaid: l.feesPaid + fee };
}

export function equity(l: Ledger, price: number): number {
  return l.cash + l.units * price;
}
