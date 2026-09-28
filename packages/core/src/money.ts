/**
 * Arrodoneix a 0,1M, meitats lluny del zero (com `round(numeric, 1)` de Postgres).
 * Primer es neteja l'error de coma flotant (8,65 × 10 = 86,49999…).
 */
export function round1(n: number): number {
  const x = Number((n * 10).toFixed(6));
  return (Math.sign(x) * Math.round(Math.abs(x))) / 10 || 0;
}

/** Format del disseny: 6,0M · 12,5M · −1,0M. */
export function formatMoney(n: number): string {
  const r = round1(n);
  const s = Math.abs(r).toFixed(1).replace('.', ',') + 'M';
  return r < 0 ? '−' + s : s;
}
