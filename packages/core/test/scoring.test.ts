import { describe, expect, it } from 'vitest';
import cases from './fixtures/scoring-cases.json' with { type: 'json' };
import { goalsMismatch, managerPoints, playerPoints, validateStats, type PlayerStats, type Position, type Score } from '../src/index.js';

describe('playerPoints', () => {
  for (const c of cases) {
    it(c.name, () => {
      const r = playerPoints(c.pos as Position, c.stats as PlayerStats, c.score as Score);
      expect(r.total).toBe(c.points);
      expect(r.breakdown.reduce((a, b) => a + b.points, 0)).toBe(c.points);
    });
  }

  it('desglossament amb etiquetes del disseny', () => {
    const r = playerPoints('DAV', { minutes: 2, goals: 2, assists: 1, yellow: 1, red: 0, coach: 1 }, { goalsFor: 3, goalsAgainst: 3 });
    expect(r.breakdown.map((b) => [b.label, b.points])).toEqual([
      ['Minuts', 2],
      ['Gols ×2', 8],
      ['Assistència', 3],
      ['Empat', 1],
      ['Groga', -1],
      ['Entrenador', 1],
    ]);
  });

  it('coincideix amb la fórmula del prototip admin (calc)', () => {
    const GV = { POR: 6, DEF: 6, MIG: 5, DAV: 4 };
    const CSV = { POR: 4, DEF: 4, MIG: 1, DAV: 0 };
    const calc = (pos: Position, s: PlayerStats, sc: Score) => {
      if (!s.minutes) return 0;
      const cs = sc.goalsAgainst === 0 && s.minutes === 2 ? CSV[pos] : 0;
      const res = sc.goalsFor > sc.goalsAgainst ? 2 : sc.goalsFor === sc.goalsAgainst ? 1 : 0;
      return s.minutes + s.goals * GV[pos] + s.assists * 3 + cs + res - s.yellow - s.red * 3 + s.coach;
    };
    for (const pos of ['POR', 'DEF', 'MIG', 'DAV'] as const)
      for (const minutes of [0, 1, 2] as const)
        for (const goals of [0, 1, 2])
          for (const yellow of [0, 1] as const)
            for (const red of [0, 1] as const)
              for (const coach of [0, 3])
                for (const [gf, ga] of [[0, 0], [2, 0], [1, 1], [0, 2], [3, 1]] as const) {
                  const s = { minutes, goals, assists: goals, yellow, red, coach };
                  const sc = { goalsFor: gf, goalsAgainst: ga };
                  expect(playerPoints(pos, s, sc).total).toBe(calc(pos, s, sc));
                }
  });
});

describe('validateStats', () => {
  it('accepta stats vàlides', () => expect(validateStats({ minutes: 2, goals: 1, assists: 0, yellow: 0, red: 0, coach: 3 })).toBeNull());
  it('rebutja entrenador > 3', () => expect(validateStats({ minutes: 2, goals: 0, assists: 0, yellow: 0, red: 0, coach: 4 })).not.toBeNull());
  it('rebutja gols negatius', () => expect(validateStats({ minutes: 2, goals: -1, assists: 0, yellow: 0, red: 0, coach: 0 })).not.toBeNull());
  it('rebutja minuts fora de rang', () => expect(validateStats({ minutes: 3 as never, goals: 0, assists: 0, yellow: 0, red: 0, coach: 0 })).not.toBeNull());
});

describe('goalsMismatch', () => {
  const s = (goals: number): PlayerStats => ({ minutes: 2, goals, assists: 0, yellow: 0, red: 0, coach: 0 });
  it('quadra', () => expect(goalsMismatch([s(1), s(2)], { goalsFor: 3, goalsAgainst: 0 })).toBe(false));
  it('no quadra', () => expect(goalsMismatch([s(1)], { goalsFor: 2, goalsAgainst: 0 })).toBe(true));
});

describe('managerPoints', () => {
  const pts = new Map([['a', 5], ['b', 3], ['c', -1]]);
  it('capità ×2', () => expect(managerPoints(['a', 'b', 'c'], 'a', pts)).toBe(12));
  it('capità negatiu també compta doble', () => expect(managerPoints(['a', 'c'], 'c', pts)).toBe(3));
  it('llocs buits i jugadors sense partit sumen 0', () => expect(managerPoints(['a', null, 'z'], null, pts)).toBe(5));
  it('capità fora de l’onze no dobla', () => expect(managerPoints(['b'], 'a', pts)).toBe(3));
});
