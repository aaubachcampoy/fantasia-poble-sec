import { TIMEZONE } from './constants.js';

export interface MarketPhase {
  marketOpen: boolean;
  lineupLocked: boolean;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Dia (0 = diumenge) i hora a Madrid. */
export function localWeekTime(now: Date, timeZone = TIMEZONE): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: WEEKDAYS.indexOf(get('weekday')), hour: Number(get('hour')), minute: Number(get('minute')) };
}

/**
 * Calendari (hora de Madrid):
 * - Dilluns 00:00 – divendres 23:59: mercat obert i alineació lliure, si la jornada anterior està tancada.
 *   Si l'admin encara no l'ha tancada, tot segueix tancat fins que la tanqui.
 * - Dissabte 00:00 – 08:59: mercat tancat, alineació lliure.
 * - Dissabte 09:00 – diumenge 23:59: mercat tancat, alineació bloquejada.
 */
export function marketPhase(now: Date, previousMatchdayClosed: boolean, timeZone = TIMEZONE): MarketPhase {
  const { weekday, hour } = localWeekTime(now, timeZone);
  if (weekday === 6) return { marketOpen: false, lineupLocked: hour >= 9 };
  if (weekday === 0) return { marketOpen: false, lineupLocked: true };
  return previousMatchdayClosed ? { marketOpen: true, lineupLocked: false } : { marketOpen: false, lineupLocked: true };
}
