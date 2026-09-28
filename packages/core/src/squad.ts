import type { RuleError } from './errors.js';
import type { Limits, PlayerRef } from './types.js';

export function teamCount(squad: readonly PlayerRef[], teamId: string): number {
  return squad.filter((p) => p.teamId === teamId).length;
}

/**
 * Es pot afegir `incoming` a la plantilla? Opcionalment, `outgoing` surt a la vegada (intercanvis).
 */
export function canAdd(squad: readonly PlayerRef[], incoming: PlayerRef, limits: Limits, outgoing: readonly string[] = []): RuleError | null {
  const after = squad.filter((p) => !outgoing.includes(p.id));
  if (after.some((p) => p.id === incoming.id)) return { code: 'INVALID', detail: 'El jugador ja és a la plantilla.' };
  if (after.length + 1 > limits.squadMax) return { code: 'SQUAD_FULL', max: limits.squadMax };
  if (teamCount(after, incoming.teamId) + 1 > limits.maxPerTeam) return { code: 'TEAM_LIMIT', teamId: incoming.teamId, max: limits.maxPerTeam };
  return null;
}

/** Valida una plantilla sencera (repartiment, seed). */
export function validateSquad(squad: readonly PlayerRef[], limits: Limits): RuleError | null {
  if (new Set(squad.map((p) => p.id)).size !== squad.length) return { code: 'INVALID', detail: 'Jugador repetit a la plantilla.' };
  if (squad.length > limits.squadMax) return { code: 'SQUAD_FULL', max: limits.squadMax };
  const counts = new Map<string, number>();
  for (const p of squad) counts.set(p.teamId, (counts.get(p.teamId) ?? 0) + 1);
  for (const [teamId, n] of counts) if (n > limits.maxPerTeam) return { code: 'TEAM_LIMIT', teamId, max: limits.maxPerTeam };
  return null;
}

export function squadValue(squad: readonly PlayerRef[]): number {
  return squad.reduce((a, p) => a + p.price, 0);
}
