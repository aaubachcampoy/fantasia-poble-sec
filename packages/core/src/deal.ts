import { INITIAL_DEAL, POSITIONS } from './constants.js';
import { shuffle } from './rng.js';
import type { PlayerRef } from './types.js';

/**
 * Repartiment inicial de 15 jugadors (2 POR, 5 DEF, 5 MIG, 3 DAV) entre els lliures de la lliga,
 * amb com a màxim `maxPerTeam` del mateix equip real. Retorna null si no és possible.
 */
export function dealSquad(available: readonly PlayerRef[], rng: () => number, maxPerTeam: number, attempts = 20): PlayerRef[] | null {
  for (let t = 0; t < attempts; t++) {
    const pool = shuffle(rng, available);
    const counts = new Map<string, number>();
    const squad: PlayerRef[] = [];
    let ok = true;
    for (const pos of POSITIONS) {
      for (let k = 0; k < INITIAL_DEAL[pos]; k++) {
        const p = pool.find((c) => c.position === pos && !squad.includes(c) && (counts.get(c.teamId) ?? 0) < maxPerTeam);
        if (!p) {
          ok = false;
          break;
        }
        squad.push(p);
        counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
      }
      if (!ok) break;
    }
    if (ok) return squad;
  }
  return null;
}
