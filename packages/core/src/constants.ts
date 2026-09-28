export const POSITIONS = ['POR', 'DEF', 'MIG', 'DAV'] as const;
export type Position = (typeof POSITIONS)[number];

/** Punts per gol segons la posició. */
export const GOAL_POINTS: Record<Position, number> = { POR: 6, DEF: 6, MIG: 5, DAV: 4 };
/** Punts per porteria a zero (només amb més de mig partit). */
export const CLEAN_SHEET_POINTS: Record<Position, number> = { POR: 4, DEF: 4, MIG: 1, DAV: 0 };
export const ASSIST_POINTS = 3;
export const WIN_POINTS = 2;
export const DRAW_POINTS = 1;
export const YELLOW_POINTS = -1;
export const RED_POINTS = -3;
export const COACH_MAX = 3;
export const CAPTAIN_MULTIPLIER = 2;

export const SQUAD_MAX = 18;
export const DEFAULT_MAX_PER_TEAM = 3;
/** Repartiment inicial: 15 jugadors. */
export const INITIAL_DEAL: Record<Position, number> = { POR: 2, DEF: 5, MIG: 5, DAV: 3 };
/** Onze en 4-4-2. */
export const XI_FORMATION: Record<Position, number> = { POR: 1, DEF: 4, MIG: 4, DAV: 2 };
/** 4 suplents, un per posició. */
export const BENCH_FORMATION: Record<Position, number> = { POR: 1, DEF: 1, MIG: 1, DAV: 1 };

export const CLAUSE_MULTIPLIER = 1.5;
export const DAILY_LISTING_SIZE = 16;
export const LEAGUE_SIZES = [10, 20, 30, 50] as const;

export const MONEY_PER_POINT = 0.1;
export const PODIUM_PRIZES = [3, 2, 1] as const;
export const INITIAL_BALANCE = 0;

/** Preu inicial: 6M fins al S12 (futbol 7), 8M a partir del S13 (futbol 11). */
export const BASE_PRICE_F7 = 6;
export const BASE_PRICE_F11 = 8;
export const F7_MAX_AGE = 12;
/** Un preu mai baixa més d'1,0M per sota de l'inicial. */
export const MAX_PRICE_DROP = 1;
export const PRICE_PER_POINT_OVER_PAR = 0.05;
export const PRICE_PAR_POINTS = 5;
export const DEMAND_WEIGHT = 0.3;
export const DEMAND_OFFSET = 0.1;

export const TIMEZONE = 'Europe/Madrid';
