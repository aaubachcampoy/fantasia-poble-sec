/** Arrodoneix a 0,1M (evita errors de coma flotant). */
export function round1(n: number): number {
  return Math.round(n * 10 + Number.EPSILON * Math.sign(n)) / 10;
}

/** Format del disseny: 6,0M · 12,5M · −1,0M. */
export function formatMoney(n: number): string {
  const r = round1(n);
  const s = Math.abs(r).toFixed(1).replace('.', ',') + 'M';
  return r < 0 ? '−' + s : s;
}
