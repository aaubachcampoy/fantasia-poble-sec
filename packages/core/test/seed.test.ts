import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateSeedData, playerPoints, seedFixture, seedPublishedInJ5 } from '../src/index.js';

// build() del prototip d'admin, executat tal qual.
function prototypeBuild(): any {
  const html = readFileSync(fileURLToPath(new URL('../../../handoff_apa_fantasy/design/Admin APA.dc.html', import.meta.url)), 'utf8');
  const start = html.indexOf('  build() {');
  const end = html.indexOf('\n  fmt(n)', start);
  const body = html.slice(start, end).trim().replace(/^build\(\) \{/, '').replace(/\}$/, '');
  return new Function(body)();
}

describe('generateSeedData', () => {
  const proto = prototypeBuild();
  const data = generateSeedData();

  it('20 equips i 260 jugadors com el prototip', () => {
    expect(data.teams).toHaveLength(20);
    expect(data.players).toHaveLength(260);
    expect(proto.P).toHaveLength(260);
  });

  it('equips, partits de la J5 i resultats idèntics', () => {
    data.teams.forEach((t, i) => {
      const p = proto.teams[i];
      expect([t.name, t.age, t.short, t.j5.rival, t.j5.isHome ? 1 : 0, t.j5.kickoff]).toEqual([p.name, p.age, p.short, p.rival, p.home, p.time]);
      expect(t.results.map((r) => [r.goalsFor, r.goalsAgainst])).toEqual(p.res.map((r: any) => [r.gf, r.ga]));
    });
  });

  it('jugadors, preus i estadístiques idèntics; mateixos punts', () => {
    data.players.forEach((pl, i) => {
      const p = proto.P[i];
      expect([pl.name, pl.team, pl.position, pl.number]).toEqual([p.name, p.team, p.pos, p.num]);
      expect(pl.price).toBeCloseTo(p.price, 9);
      pl.stats.forEach((s, j) => {
        const b = p.bds[j];
        expect([s.minutes, s.goals, s.assists, s.yellow, s.coach]).toEqual([b.min, b.g, b.a, b.y, b.coach]);
        const res = data.teams[pl.team]!.results[j]!;
        expect(playerPoints(pl.position, s, res).total).toBe(b.pts);
      });
    });
  });

  it('cap nom repetit, 13 per equip i preus a partir d’inicial − 1M', () => {
    expect(new Set(data.players.map((p) => p.name)).size).toBe(260);
    for (let t = 0; t < 20; t++) expect(data.players.filter((p) => p.team === t)).toHaveLength(13);
    expect(data.players.every((p) => p.price >= (data.teams[p.team]!.age <= 12 ? 5 : 7))).toBe(true);
  });

  it('partits J1–J4 inventats però coherents', () => {
    const t = data.teams[0]!;
    expect(seedFixture(t, 0, 5)).toEqual(t.j5);
    expect(seedFixture(t, 0, 4).isHome).toBe(!t.j5.isHome);
    expect(data.teams.filter(seedPublishedInJ5).length).toBeGreaterThan(10);
  });
});
