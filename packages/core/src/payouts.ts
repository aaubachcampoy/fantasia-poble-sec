import { MONEY_PER_POINT, PODIUM_PRIZES } from './constants.js';
import { round1 } from './money.js';

export interface ManagerMatchdayScore {
  managerId: string;
  points: number;
  /** Per desempatar el podi: qui va entrar abans a la lliga. */
  joinedAt: string | number;
}

export interface Payout {
  managerId: string;
  rank: number;
  points: number;
  pointsMoney: number;
  prize: number;
  total: number;
}

/** Diners de la jornada dins d'una lliga: 0,1M per punt (mai negatiu) + 3M / 2M / 1M al podi. */
export function matchdayPayouts(scores: readonly ManagerMatchdayScore[]): Payout[] {
  const sorted = scores.slice().sort((a, b) => b.points - a.points || (a.joinedAt < b.joinedAt ? -1 : a.joinedAt > b.joinedAt ? 1 : 0));
  return sorted.map((s, i) => {
    const pointsMoney = round1(Math.max(0, s.points) * MONEY_PER_POINT);
    const prize = PODIUM_PRIZES[i] ?? 0;
    return { managerId: s.managerId, rank: i + 1, points: s.points, pointsMoney, prize, total: round1(pointsMoney + prize) };
  });
}
