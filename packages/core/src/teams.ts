import { BASE_PRICE_F11, BASE_PRICE_F7, F7_MAX_AGE, MAX_PRICE_DROP } from './constants.js';

export type Format = 'F7' | 'F11';

export function teamFormat(age: number): Format {
  return age <= F7_MAX_AGE ? 'F7' : 'F11';
}

export function formatLabel(age: number): string {
  return teamFormat(age) === 'F7' ? 'Futbol 7' : 'Futbol 11';
}

export function basePrice(age: number): number {
  return teamFormat(age) === 'F7' ? BASE_PRICE_F7 : BASE_PRICE_F11;
}

export function minPrice(age: number): number {
  return basePrice(age) - MAX_PRICE_DROP;
}
