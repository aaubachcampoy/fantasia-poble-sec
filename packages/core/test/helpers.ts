import type { PlayerRef, Position } from '../src/index.js';

let n = 0;
export function player(position: Position, teamId = 't' + n, price = 6): PlayerRef {
  n++;
  return { id: 'p' + n, teamId, position, price };
}

export const LIMITS = { squadMax: 18, maxPerTeam: 3 };
