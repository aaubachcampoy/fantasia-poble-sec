import { describe, expect, it } from 'vitest';
import {
  effectiveCaptain,
  emptySlots,
  fillSlot,
  initialLineup,
  isRuleError,
  placePlayer,
  removePlayer,
  reserveIds,
  setCaptain,
  swapPlayers,
  validateLineup,
  xiIds,
  type Lineup,
  type PlayerRef,
} from '../src/index.js';
import { player } from './helpers.js';

function squad15(): PlayerRef[] {
  return [
    ...Array.from({ length: 2 }, (_, i) => player('POR', 'a' + i, 6 + i)),
    ...Array.from({ length: 5 }, (_, i) => player('DEF', 'b' + i, 6 + i)),
    ...Array.from({ length: 5 }, (_, i) => player('MIG', 'c' + i, 6 + i)),
    ...Array.from({ length: 3 }, (_, i) => player('DAV', 'd' + i, 6 + i)),
  ];
}

describe('emptySlots', () => {
  it('4-4-2 + 4 suplents (1 per posició)', () => {
    const s = emptySlots();
    expect(s).toHaveLength(15);
    expect(s.filter((x) => x.group === 'xi').map((x) => x.position).join(',')).toBe('POR,DEF,DEF,DEF,DEF,MIG,MIG,MIG,MIG,DAV,DAV');
    expect(s.filter((x) => x.group === 'bench').map((x) => x.position).join(',')).toBe('POR,DEF,MIG,DAV');
  });
});

describe('initialLineup', () => {
  it('omple onze i banqueta amb els 15 del repartiment, capità el millor', () => {
    const sq = squad15();
    const l = initialLineup(sq);
    expect(validateLineup(l, sq)).toBeNull();
    expect(xiIds(l)).toHaveLength(11);
    expect(l.slots.every((s) => s.playerId != null)).toBe(true);
    expect(reserveIds(l, sq.map((p) => p.id))).toEqual([]);
    const best = sq.filter((p) => xiIds(l).includes(p.id)).sort((a, b) => b.price - a.price)[0]!;
    expect(l.captainId).toBe(best.id);
    const benchPor = l.slots.find((s) => s.group === 'bench' && s.position === 'POR')!.playerId;
    expect(sq.find((p) => p.id === benchPor)!.price).toBe(6);
  });

  it('el jugador 16 va a la reserva', () => {
    const sq = squad15();
    const extra = player('DEF');
    const l = placePlayer(initialLineup(sq), extra);
    expect(reserveIds(l, [...sq, extra].map((p) => p.id))).toEqual([extra.id]);
  });
});

describe('canvis', () => {
  const sq = squad15();
  const base = initialLineup(sq);
  const byId = (id: string) => sq.find((p) => p.id === id)!;

  it('titular ↔ suplent de la mateixa posició', () => {
    const tit = base.slots.find((s) => s.group === 'xi' && s.position === 'DEF' && s.playerId !== base.captainId)!.playerId!;
    const sup = base.slots.find((s) => s.group === 'bench' && s.position === 'DEF')!.playerId!;
    const l = swapPlayers(base, byId(tit), byId(sup)) as Lineup;
    expect(xiIds(l)).toContain(sup);
    expect(xiIds(l)).not.toContain(tit);
  });

  it('no es poden canviar posicions diferents', () => {
    const a = base.slots[0]!.playerId!;
    const b = base.slots[1]!.playerId!;
    expect(isRuleError(swapPlayers(base, byId(a), byId(b)))).toBe(true);
  });

  it('si el capità surt de l’onze, sense capità', () => {
    const cap = byId(base.captainId!);
    const sup = base.slots.find((s) => s.group === 'bench' && s.position === cap.position)!.playerId!;
    const l = swapPlayers(base, cap, byId(sup)) as Lineup;
    expect(l.captainId).toBeNull();
  });

  it('vendre el capità el treu i deixa el lloc buit', () => {
    const l = removePlayer(base, base.captainId!);
    expect(l.captainId).toBeNull();
    expect(xiIds(l)).toHaveLength(10);
    expect(validateLineup(l, sq)).toBeNull();
  });

  it("posar a l'onze un lloc buit", () => {
    const out = base.slots[1]!.playerId!;
    const l0 = removePlayer(base, out);
    const sup = l0.slots.find((s) => s.group === 'bench' && s.position === 'DEF')!.playerId!;
    const l = fillSlot(l0, byId(sup), 1) as Lineup;
    expect(l.slots[1]!.playerId).toBe(sup);
    expect(l.slots.find((s) => s.group === 'bench' && s.position === 'DEF')!.playerId).toBeNull();
  });

  it('capità només de l’onze', () => {
    const sup = base.slots.find((s) => s.group === 'bench')!.playerId!;
    expect(isRuleError(setCaptain(base, sup))).toBe(true);
    const tit = base.slots[3]!.playerId!;
    expect(effectiveCaptain(setCaptain(base, tit) as Lineup)).toBe(tit);
  });
});

describe('validateLineup', () => {
  const sq = squad15();
  const base = initialLineup(sq);
  it('rebutja jugadors que no són de la plantilla', () => {
    const l = { ...base, slots: base.slots.map((s, i) => (i === 0 ? { ...s, playerId: 'aliè' } : s)) };
    expect(validateLineup(l, sq)?.code).toBe('NOT_OWNER');
  });
  it('rebutja jugadors fora de posició', () => {
    const def = sq.find((p) => p.position === 'DEF')!.id;
    const l = { ...base, slots: base.slots.map((s, i) => (i === 0 ? { ...s, playerId: def } : s)) };
    expect(validateLineup(l, sq)?.code).toBe('INVALID');
  });
  it('rebutja formacions que no són 4-4-2', () => {
    expect(validateLineup({ slots: base.slots.slice(1), captainId: null }, sq)?.code).toBe('INVALID');
  });
});
