import { BENCH_FORMATION, POSITIONS, XI_FORMATION, type Position } from './constants.js';
import type { RuleError } from './errors.js';
import type { PlayerRef } from './types.js';

export type SlotGroup = 'xi' | 'bench';

export interface LineupSlot {
  position: Position;
  group: SlotGroup;
  playerId: string | null;
}

export interface Lineup {
  /** 11 de l'onze (1-4-4-2) i 4 suplents, en aquest ordre. */
  slots: LineupSlot[];
  captainId: string | null;
}

export function emptySlots(): LineupSlot[] {
  const slots: LineupSlot[] = [];
  for (const [group, f] of [['xi', XI_FORMATION], ['bench', BENCH_FORMATION]] as const) {
    for (const position of POSITIONS) for (let k = 0; k < f[position]; k++) slots.push({ position, group, playerId: null });
  }
  return slots;
}

export function xiIds(l: Lineup): string[] {
  return l.slots.filter((s) => s.group === 'xi' && s.playerId != null).map((s) => s.playerId as string);
}

/** Jugadors de la plantilla que no són ni titulars ni suplents. */
export function reserveIds(l: Lineup, squadIds: readonly string[]): string[] {
  const used = new Set(l.slots.map((s) => s.playerId));
  return squadIds.filter((id) => !used.has(id));
}

/** El capità només compta si és a l'onze. */
export function effectiveCaptain(l: Lineup): string | null {
  return l.captainId != null && xiIds(l).includes(l.captainId) ? l.captainId : null;
}

export function validateLineup(l: Lineup, squad: readonly PlayerRef[]): RuleError | null {
  const expected = emptySlots();
  if (l.slots.length !== expected.length || l.slots.some((s, i) => s.position !== expected[i]?.position || s.group !== expected[i]?.group)) {
    return { code: 'INVALID', detail: "L'alineació no té la forma 4-4-2 + 4 suplents." };
  }
  const byId = new Map(squad.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (const s of l.slots) {
    if (s.playerId == null) continue;
    const p = byId.get(s.playerId);
    if (!p) return { code: 'NOT_OWNER' };
    if (p.position !== s.position) return { code: 'INVALID', detail: 'Jugador fora de la seva posició.' };
    if (seen.has(s.playerId)) return { code: 'INVALID', detail: 'Jugador repetit a l’alineació.' };
    seen.add(s.playerId);
  }
  if (l.captainId != null && !xiIds(l).includes(l.captainId)) return { code: 'INVALID', detail: "El capità ha de ser a l'onze." };
  return null;
}

/** Col·loca un jugador nou: primer lloc buit de l'onze, si no de la banqueta, si no a la reserva. */
export function placePlayer(l: Lineup, p: PlayerRef): Lineup {
  const slots = l.slots.map((s) => ({ ...s }));
  const i = slots.findIndex((s) => s.playerId == null && s.position === p.position && s.group === 'xi');
  const j = i >= 0 ? i : slots.findIndex((s) => s.playerId == null && s.position === p.position);
  if (j >= 0) (slots[j] as LineupSlot).playerId = p.id;
  return { slots, captainId: l.captainId };
}

/** Treu un jugador (venda, clàusula, intercanvi). Si era el capità, es queda sense capità. */
export function removePlayer(l: Lineup, id: string): Lineup {
  return {
    slots: l.slots.map((s) => (s.playerId === id ? { ...s, playerId: null } : s)),
    captainId: l.captainId === id ? null : l.captainId,
  };
}

/**
 * Canvia dos jugadors de la mateixa posició (onze ↔ banqueta ↔ reserva).
 * Si el capità surt de l'onze, es queda sense capità.
 */
export function swapPlayers(l: Lineup, a: PlayerRef, b: PlayerRef): Lineup | RuleError {
  if (a.position !== b.position) return { code: 'INVALID', detail: 'Només es poden canviar jugadors de la mateixa posició.' };
  const slots = l.slots.map((s) => ({ ...s }));
  const ia = slots.findIndex((s) => s.playerId === a.id);
  const ib = slots.findIndex((s) => s.playerId === b.id);
  if (ia < 0 && ib < 0) return { code: 'INVALID', detail: 'Cap dels dos jugadors és a l’alineació.' };
  if (ia >= 0) (slots[ia] as LineupSlot).playerId = b.id;
  if (ib >= 0) (slots[ib] as LineupSlot).playerId = a.id;
  const next = { slots, captainId: l.captainId };
  return { slots, captainId: effectiveCaptain(next) };
}

/** Posa un jugador en un lloc buit concret (p. ej. «Posar a l'onze»). */
export function fillSlot(l: Lineup, p: PlayerRef, index: number): Lineup | RuleError {
  const target = l.slots[index];
  if (!target || target.playerId != null) return { code: 'INVALID', detail: 'Aquest lloc no és buit.' };
  if (target.position !== p.position) return { code: 'INVALID', detail: 'Jugador fora de la seva posició.' };
  const slots = l.slots.map((s) => (s.playerId === p.id ? { ...s, playerId: null } : { ...s }));
  (slots[index] as LineupSlot).playerId = p.id;
  const next = { slots, captainId: l.captainId };
  return { slots, captainId: effectiveCaptain(next) };
}

export function setCaptain(l: Lineup, id: string): Lineup | RuleError {
  if (!xiIds(l).includes(id)) return { code: 'INVALID', detail: "El capità ha de ser a l'onze." };
  return { slots: l.slots, captainId: id };
}

/**
 * Alineació inicial: els millors per posició (segons `rank`, més alt = millor) a l'onze,
 * el següent a la banqueta i capità el millor de l'onze.
 */
export function initialLineup(squad: readonly PlayerRef[], rank: (p: PlayerRef) => number = (p) => p.price): Lineup {
  let l: Lineup = { slots: emptySlots(), captainId: null };
  const sorted = squad.slice().sort((a, b) => rank(b) - rank(a));
  for (const p of sorted) l = placePlayer(l, p);
  const byId = new Map(squad.map((p) => [p.id, p]));
  const best = xiIds(l).sort((a, b) => rank(byId.get(b) as PlayerRef) - rank(byId.get(a) as PlayerRef))[0];
  return { ...l, captainId: best ?? null };
}

export function isRuleError(x: unknown): x is RuleError {
  return typeof x === 'object' && x !== null && 'code' in x;
}
