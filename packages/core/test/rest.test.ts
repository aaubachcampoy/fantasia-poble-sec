import { describe, expect, it } from 'vitest';
import { basePrice, round1, createRng, dealSquad, formatMoney, marketPhase, matchdayPayouts, minPrice, nextPrice, teamFormat, validateSquad, type PlayerRef, type Position } from '../src/index.js';

describe('money', () => {
  it('format del disseny', () => {
    expect(formatMoney(6)).toBe('6,0M');
    expect(formatMoney(12.345)).toBe('12,3M');
    expect(formatMoney(-1)).toBe('−1,0M');
    expect(formatMoney(0.1 + 0.2)).toBe('0,3M');
  });
});

describe('equips', () => {
  it('F7 fins al S12 a 6M, F11 des del S13 a 8M', () => {
    expect([teamFormat(8), basePrice(8), minPrice(8)]).toEqual(['F7', 6, 5]);
    expect([teamFormat(12), basePrice(12)]).toEqual(['F7', 6]);
    expect([teamFormat(13), basePrice(13), minPrice(13)]).toEqual(['F11', 8, 7]);
    expect(basePrice(20)).toBe(8);
  });
});

describe('rng', () => {
  it('mateixa seqüència que el prototip (Park–Miller, llavor 20260927)', () => {
    let s = 20260927;
    const proto = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    const r = createRng();
    for (let i = 0; i < 1000; i++) expect(r()).toBe(proto());
  });
});

describe('nextPrice', () => {
  it('rendiment i demanda', () => {
    // 15 punts: +0,5; propietari a totes les lligues: +0,2
    expect(nextPrice({ price: 8, teamAge: 14, points: 15, ownedRatio: 1 })).toBe(8.7);
    // 5 punts i ningú el té: −0,1
    expect(nextPrice({ price: 6, teamAge: 10, points: 5, ownedRatio: 0 })).toBe(5.9);
  });
  it('mai per sota d’inicial − 1M', () => {
    expect(nextPrice({ price: 5.1, teamAge: 10, points: 0, ownedRatio: 0 })).toBe(5);
    expect(nextPrice({ price: 7, teamAge: 16, points: -3, ownedRatio: 0 })).toBe(7);
  });
});

describe('matchdayPayouts', () => {
  it('0,1M per punt + podi 3/2/1; empat, qui va entrar abans', () => {
    const r = matchdayPayouts([
      { managerId: 'a', points: 40, joinedAt: 2 },
      { managerId: 'b', points: 55, joinedAt: 3 },
      { managerId: 'c', points: 40, joinedAt: 1 },
      { managerId: 'd', points: 12, joinedAt: 0 },
      { managerId: 'e', points: -4, joinedAt: 0 },
    ]);
    expect(r.map((x) => [x.managerId, x.rank, x.total])).toEqual([
      ['b', 1, 8.5],
      ['c', 2, 6],
      ['a', 3, 5],
      ['d', 4, 1.2],
      ['e', 5, 0],
    ]);
  });
});

describe('marketPhase (hora de Madrid)', () => {
  // 2026-09-28 és dilluns. CEST = UTC+2.
  const at = (iso: string) => new Date(iso);
  it('dilluns 00:00 obre si la jornada està tancada', () => {
    expect(marketPhase(at('2026-09-27T22:00:00Z'), true)).toEqual({ marketOpen: true, lineupLocked: false });
    expect(marketPhase(at('2026-09-27T21:59:00Z'), true)).toEqual({ marketOpen: false, lineupLocked: true });
  });
  it('si la jornada no està tancada, espera', () => expect(marketPhase(at('2026-09-29T10:00:00Z'), false)).toEqual({ marketOpen: false, lineupLocked: true }));
  it('divendres 23:59 obert; dissabte 00:00 tancat però alineació lliure', () => {
    expect(marketPhase(at('2026-10-02T21:59:00Z'), true).marketOpen).toBe(true);
    expect(marketPhase(at('2026-10-02T22:00:00Z'), true)).toEqual({ marketOpen: false, lineupLocked: false });
  });
  it('dissabte abans de les 09:00, si l’admin no ha tancat la jornada anterior, tot segueix bloquejat', () => {
    expect(marketPhase(at('2026-10-02T22:00:00Z'), false)).toEqual({ marketOpen: false, lineupLocked: true });
  });
  it('proporció de demanda arrodonida a 2 decimals', () => {
    expect(nextPrice({ price: 5, teamAge: 10, points: 4, ownedRatio: 2 / 3 })).toBe(5.1);
  });
  it('dissabte 09:00 bloqueja alineacions', () => {
    expect(marketPhase(at('2026-10-03T06:59:00Z'), true).lineupLocked).toBe(false);
    expect(marketPhase(at('2026-10-03T07:00:00Z'), true).lineupLocked).toBe(true);
  });
  it('funciona amb l’horari d’hivern (CET = UTC+1)', () => {
    // dissabte 7 de novembre de 2026, 09:00 CET = 08:00Z
    expect(marketPhase(at('2026-11-07T07:59:00Z'), true).lineupLocked).toBe(false);
    expect(marketPhase(at('2026-11-07T08:00:00Z'), true).lineupLocked).toBe(true);
  });
});

describe('dealSquad', () => {
  const pos: Position[] = ['POR', 'POR', 'DEF', 'DEF', 'DEF', 'DEF', 'MIG', 'MIG', 'MIG', 'MIG', 'DAV', 'DAV', 'DAV'];
  const all: PlayerRef[] = Array.from({ length: 20 }, (_, t) => pos.map((position, k) => ({ id: `t${t}-${k}`, teamId: 't' + t, position, price: 6 }))).flat();

  it('15 jugadors 2/5/5/3, màxim 3 per equip', () => {
    const sq = dealSquad(all, createRng(1), 3)!;
    expect(sq).toHaveLength(15);
    const c = (p: Position) => sq.filter((x) => x.position === p).length;
    expect([c('POR'), c('DEF'), c('MIG'), c('DAV')]).toEqual([2, 5, 5, 3]);
    expect(validateSquad(sq, { squadMax: 18, maxPerTeam: 3 })).toBeNull();
  });

  it('12 mànagers sense repetir jugadors a la mateixa lliga', () => {
    const rng = createRng(20260927);
    let free = all.slice();
    for (let m = 0; m < 12; m++) {
      const sq = dealSquad(free, rng, 3)!;
      expect(sq).not.toBeNull();
      const taken = new Set(sq.map((p) => p.id));
      free = free.filter((p) => !taken.has(p.id));
    }
    expect(free).toHaveLength(260 - 180);
  });

  it('null si no n’hi ha prou', () => expect(dealSquad(all.filter((p) => p.position !== 'POR'), createRng(1), 3)).toBeNull());
});

describe('round1', () => {
  it('meitats lluny del zero, sense errors de coma flotant', () => {
    expect(round1(8.65)).toBe(8.7);
    expect(round1(0.1 + 0.2)).toBe(0.3);
    expect(round1(-0.05)).toBe(-0.1);
    expect(round1(-0.04)).toBe(0);
    expect(Object.is(round1(-0.04), -0)).toBe(false);
  });
});
