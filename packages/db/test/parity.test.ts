import { marketPhase, nextPrice, playerPoints, POSITIONS, type Minutes, type PlayerStats, type Position } from '@apa/core';
import { describe, expect, it } from 'vitest';
import cases from '../../core/test/fixtures/scoring-cases.json' with { type: 'json' };
import { hasDb, useDb } from './db.js';

describe.skipIf(!hasDb)('SQL = core', () => {
  const db = useDb();

  const calc = async (pos: Position, s: PlayerStats, gf: number, ga: number) => {
    const [r] = await db.sql(`select points, breakdown from private.calc_points($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
      pos, s.minutes, s.goals, s.assists, s.yellow, s.red, s.coach, gf, ga,
    ]);
    return r as { points: number; breakdown: { key: string; label: string; points: number }[] };
  };

  it('casos compartits de puntuació', async () => {
    for (const c of cases) {
      const r = await calc(c.pos as Position, c.stats as PlayerStats, c.score.goalsFor, c.score.goalsAgainst);
      expect(r.points, c.name).toBe(c.points);
    }
  });

  it('mateixos punts i mateix desglossament en totes les combinacions', async () => {
    const rows: unknown[][] = [];
    const expected: ReturnType<typeof playerPoints>[] = [];
    for (const pos of POSITIONS)
      for (const minutes of [0, 1, 2] as Minutes[])
        for (const goals of [0, 1, 3])
          for (const assists of [0, 1, 2])
            for (const yellow of [0, 1] as const)
              for (const red of [0, 1] as const)
                for (const coach of [0, 2, 3])
                  for (const [gf, ga] of [[0, 0], [3, 0], [1, 1], [0, 2]] as const) {
                    rows.push([pos, minutes, goals, assists, yellow, red, coach, gf, ga]);
                    expected.push(playerPoints(pos, { minutes, goals, assists, yellow, red, coach }, { goalsFor: gf, goalsAgainst: ga }));
                  }
    const got = await db.sql(
      `select (private.calc_points(r.pos::public.position, r.m, r.g, r.a, r.y, r.r, r.c, r.gf, r.ga)).*
       from jsonb_to_recordset($1::jsonb) as r(i int, pos text, m int, g int, a int, y int, r int, c int, gf int, ga int) order by r.i`,
      [JSON.stringify(rows.map(([pos, m, g, a, y, r, c, gf, ga], i) => ({ i, pos, m, g, a, y, r, c, gf, ga })))],
    );
    expect(got).toHaveLength(expected.length);
    got.forEach((r, i) => {
      expect(r.points).toBe(expected[i]!.total);
      expect(r.breakdown).toEqual(expected[i]!.breakdown);
    });
  });

  it('preu en tancar la jornada', async () => {
    const inputs: { price: number; teamAge: number; points: number; ownedRatio: number }[] = [];
    for (const price of [5, 5.1, 6, 6.35, 7.9, 8.65, 11.2])
      for (const teamAge of [10, 16])
        for (const points of [-3, 0, 4, 5, 6, 13, 27])
          for (const ownedRatio of [0, 1 / 3, 0.5, 2 / 3, 1]) inputs.push({ price, teamAge, points, ownedRatio });
    const got = await db.sql(
      `select private.next_price(r.price, case when r.age <= 12 then 6 else 8 end, r.points, r.ratio)::float8 as p
       from jsonb_to_recordset($1::jsonb) as r(i int, price numeric, age int, points int, ratio numeric) order by r.i`,
      [JSON.stringify(inputs.map((x, i) => ({ i, price: x.price, age: x.teamAge, points: x.points, ratio: x.ownedRatio })))],
    );
    got.forEach((r, i) => expect(r.p, JSON.stringify(inputs[i])).toBe(nextPrice(inputs[i]!)));
  });

  it('calendari del mercat (hora de Madrid)', async () => {
    // Jornada en curs J5 (bloquejada): de dilluns a divendres tot tancat.
    // Després tanquem la J5 i la J6 (dissabte 3/10) queda com a jornada en curs.
    const check = async (closed: boolean) => {
      for (let h = 0; h < 24 * 6; h += 1) {
        const t = new Date(Date.UTC(2026, 8, 27, 22) + h * 3600_000 + 30_000); // dilluns 28/9 00:00:30 Madrid → dissabte
        db.at(t.toISOString());
        const [s] = await db.sql(`select market_open, lineup_locked from public.market_status()`);
        expect(s, t.toISOString()).toEqual(
          (({ marketOpen, lineupLocked }) => ({ market_open: marketOpen, lineup_locked: lineupLocked }))(marketPhase(t, closed)),
        );
      }
    };
    await check(false);
    await db.sql(`update public.matchdays set status = 'closed' where number = 5;
      insert into public.matchdays (season_id, number, sat_date) values (1, 6, '2026-10-03');
      update public.seasons set current_matchday_id = (select id from public.matchdays where number = 6)`);
    await check(true);
  });

  it('format de diners i tancament del mercat', async () => {
    const [r] = await db.sql(`select private.fmt(6) a, private.fmt(12.35) b,
      private.market_close_after('2026-09-30T12:00:00Z') c, private.market_close_after('2026-10-21T12:00:00Z') d, private.market_close_after('2026-10-28T12:00:00Z') e`);
    expect([r.a, r.b]).toEqual(['6,0M', '12,4M']);
    expect(r.c.toISOString()).toBe('2026-10-02T22:00:00.000Z'); // dissabte 3/10 00:00 CEST
    expect(r.d.toISOString()).toBe('2026-10-23T22:00:00.000Z'); // dissabte 24/10 00:00 CEST
    expect(r.e.toISOString()).toBe('2026-10-30T23:00:00.000Z'); // canvi d'hora el 25/10: dissabte 31/10 00:00 CET
  });
});
