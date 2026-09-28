import { DEMAND_OFFSET, DEMAND_WEIGHT, PRICE_PAR_POINTS, PRICE_PER_POINT_OVER_PAR } from './constants.js';
import { round1 } from './money.js';
import { minPrice } from './teams.js';

export interface PriceInput {
  price: number;
  /** Edat de l'equip (per al preu mínim). */
  teamAge: number;
  /** Punts a la jornada (0 si no ha jugat). */
  points: number;
  /** Proporció de lligues on el jugador té propietari (0–1). */
  ownedRatio: number;
}

/** Preu en tancar la jornada: rendiment + demanda, arrodonit a 0,1M i mai per sota d'inicial − 1M. */
export function nextPrice({ price, teamAge, points, ownedRatio }: PriceInput): number {
  const ratio = Math.min(1, Math.max(0, ownedRatio));
  const delta = (points - PRICE_PAR_POINTS) * PRICE_PER_POINT_OVER_PAR + DEMAND_WEIGHT * ratio - DEMAND_OFFSET;
  return Math.max(minPrice(teamAge), round1(price + delta));
}
