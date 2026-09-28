/** Park–Miller (minimal standard), el mateix generador dels prototips. Llavor per defecte: 20260927. */
export function createRng(seed = 20260927): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick: llista buida');
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** Fisher–Yates; no modifica l'original. */
export function shuffle<T>(rng: () => number, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}
