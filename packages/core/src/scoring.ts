import {
  ASSIST_POINTS,
  CAPTAIN_MULTIPLIER,
  CLEAN_SHEET_POINTS,
  COACH_MAX,
  DRAW_POINTS,
  GOAL_POINTS,
  RED_POINTS,
  WIN_POINTS,
  YELLOW_POINTS,
  type Position,
} from './constants.js';

/** 0 = no juga, 1 = menys de mig partit, 2 = més de mig partit. */
export type Minutes = 0 | 1 | 2;

export interface PlayerStats {
  minutes: Minutes;
  goals: number;
  assists: number;
  yellow: 0 | 1;
  red: 0 | 1;
  /** Valoració de l'entrenador, 0–3. */
  coach: number;
}

export interface Score {
  /** Gols de l'APA. */
  goalsFor: number;
  /** Gols del rival. */
  goalsAgainst: number;
}

export type BreakdownKey = 'minutes' | 'goals' | 'assists' | 'cleanSheet' | 'win' | 'draw' | 'yellow' | 'red' | 'coach';

export interface BreakdownItem {
  key: BreakdownKey;
  label: string;
  points: number;
}

export interface PointsResult {
  total: number;
  breakdown: BreakdownItem[];
}

export const EMPTY_STATS: PlayerStats = { minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, coach: 0 };

export function validateStats(s: PlayerStats): string | null {
  if (![0, 1, 2].includes(s.minutes)) return 'Minuts ha de ser 0, 1 o 2.';
  for (const k of ['goals', 'assists'] as const) {
    if (!Number.isInteger(s[k]) || s[k] < 0) return 'Gols i assistències han de ser enters positius.';
  }
  if (![0, 1].includes(s.yellow) || ![0, 1].includes(s.red)) return 'Targetes: 0 o 1.';
  if (!Number.isInteger(s.coach) || s.coach < 0 || s.coach > COACH_MAX) return "Valoració de l'entrenador: 0 a 3.";
  return null;
}

/**
 * Punts d'un jugador en un partit. Si no juga (minuts 0), 0 punts.
 * La porteria a zero només compta amb més de mig partit.
 */
export function playerPoints(pos: Position, s: PlayerStats, score: Score): PointsResult {
  if (s.minutes === 0) return { total: 0, breakdown: [] };
  const b: BreakdownItem[] = [{ key: 'minutes', label: 'Minuts', points: s.minutes }];
  if (s.goals) b.push({ key: 'goals', label: 'Gols ×' + s.goals, points: s.goals * GOAL_POINTS[pos] });
  if (s.assists) b.push({ key: 'assists', label: s.assists > 1 ? 'Assistències ×' + s.assists : 'Assistència', points: s.assists * ASSIST_POINTS });
  if (score.goalsAgainst === 0 && s.minutes === 2 && CLEAN_SHEET_POINTS[pos] > 0) {
    b.push({ key: 'cleanSheet', label: 'Porteria a zero', points: CLEAN_SHEET_POINTS[pos] });
  }
  if (score.goalsFor > score.goalsAgainst) b.push({ key: 'win', label: 'Victòria', points: WIN_POINTS });
  else if (score.goalsFor === score.goalsAgainst) b.push({ key: 'draw', label: 'Empat', points: DRAW_POINTS });
  if (s.yellow) b.push({ key: 'yellow', label: 'Groga', points: YELLOW_POINTS });
  if (s.red) b.push({ key: 'red', label: 'Vermella', points: RED_POINTS });
  b.push({ key: 'coach', label: 'Entrenador', points: s.coach });
  return { total: b.reduce((a, x) => a + x.points, 0), breakdown: b };
}

/** Suma dels gols dels jugadors; si no quadra amb el marcador, l'admin veu un avís (poden ser en pròpia porta). */
export function goalsMismatch(stats: readonly PlayerStats[], score: Score): boolean {
  return stats.reduce((a, s) => a + s.goals, 0) !== score.goalsFor;
}

/**
 * Punts d'un mànager en una jornada: només l'onze; el capità ×2 si és a l'onze.
 * Els llocs buits sumen 0. Els jugadors sense partit (ajornat o descans) no hi són a `points` i sumen 0.
 */
export function managerPoints(xi: readonly (string | null)[], captainId: string | null, points: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const id of xi) {
    if (id == null) continue;
    const p = points.get(id) ?? 0;
    total += id === captainId ? p * CAPTAIN_MULTIPLIER : p;
  }
  return total;
}
