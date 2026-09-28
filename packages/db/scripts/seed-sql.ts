import { generateSeedData, SEED_MATCHDAYS, seedFixture, seedPublishedInJ5 } from '@apa/core';

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Dissabte de cada jornada: J1 = 29/8/2026 … J5 = 26/9/2026. */
function satDate(matchday: number): string {
  const d = new Date(Date.UTC(2026, 7, 29 + (matchday - 1) * 7));
  return d.toISOString().slice(0, 10);
}

export const fixtureId = (matchday: number, team: number) => (matchday - 1) * 20 + team + 1;

/**
 * seed.sql: temporada 2026-27, 20 equips, 260 jugadors, J1–J4 tancades i J5 en curs
 * (com al prototip d'admin: publicats els partits de dissabte i els de diumenge abans de les 13:00).
 */
export function seedSql(): string {
  const { teams, players } = generateSeedData();
  const out: string[] = [];
  out.push('-- Generat per packages/db/scripts/write-seed.ts a partir de @apa/core (llavor 20260927). No editar a mà.');
  out.push('begin;');
  out.push("insert into public.seasons (id, name, is_active) overriding system value values (1, '2026-27', true);");

  out.push('insert into public.teams (id, season_id, name, short, age, sort) overriding system value values');
  out.push(teams.map((t, i) => `  (${i + 1}, 1, ${q(t.name)}, ${q(t.short)}, ${t.age}, ${i + 1})`).join(',\n') + ';');

  out.push('insert into public.players (id, team_id, name, position, shirt_number, price) overriding system value values');
  out.push(players.map((p, i) => `  (${i + 1}, ${p.team + 1}, ${q(p.name)}, ${q(p.position)}, ${p.number}, ${p.price.toFixed(1)})`).join(',\n') + ';');

  out.push('insert into public.matchdays (id, season_id, number, sat_date, status, locked_at) overriding system value values');
  out.push(
    Array.from({ length: SEED_MATCHDAYS }, (_, k) => `  (${k + 1}, 1, ${k + 1}, '${satDate(k + 1)}', 'locked', '${satDate(k + 1)} 07:00+00')`).join(',\n') + ';',
  );

  const fx: string[] = [];
  const published: number[] = [];
  const sheets: string[] = [];
  const stats: string[] = [];
  for (let md = 1; md <= SEED_MATCHDAYS; md++) {
    teams.forEach((t, ti) => {
      const f = seedFixture(t, ti, md);
      const id = fixtureId(md, ti);
      fx.push(`  (${id}, ${md}, ${ti + 1}, ${q(f.rival)}, ${f.isHome}, '${f.day}', '${f.kickoff}')`);
      if (md < 5 || seedPublishedInJ5(t)) {
        published.push(id);
        const r = t.results[md - 1]!;
        sheets.push(`  (${id}, ${r.goalsFor}, ${r.goalsAgainst})`);
        players.forEach((p, pi) => {
          if (p.team !== ti) return;
          const s = p.stats[md - 1]!;
          stats.push(`  (${id}, ${pi + 1}, ${s.minutes}, ${s.goals}, ${s.assists}, ${s.yellow}, ${s.red}, ${s.coach})`);
        });
      }
    });
  }
  out.push('insert into public.fixtures (id, matchday_id, team_id, rival, is_home, day, kickoff) overriding system value values');
  out.push(fx.join(',\n') + ';');
  out.push('insert into public.match_sheets (fixture_id, goals_for, goals_against) values');
  out.push(sheets.join(',\n') + ';');
  out.push('insert into public.player_stats (fixture_id, player_id, minutes, goals, assists, yellow, red, coach) values');
  out.push(stats.join(',\n') + ';');

  out.push('-- Publicació amb la mateixa funció que fa servir l\'admin.');
  out.push(`do $$ begin perform private.publish_fixture(id) from unnest(array[${published.join(', ')}]::bigint[]) as id order by id; end $$;`);
  out.push(`update public.matchdays set status = 'closed', closed_at = (sat_date + 2)::timestamptz where number < ${SEED_MATCHDAYS};`);
  out.push(`update public.seasons set current_matchday_id = ${SEED_MATCHDAYS} where id = 1;`);
  out.push(
    'do $$ begin ' +
      ['seasons', 'teams', 'players', 'matchdays', 'fixtures']
        .map((t) => `perform setval(pg_get_serial_sequence('public.${t}', 'id'), (select max(id) from public.${t}));`)
        .join(' ') +
      ' end $$;',
  );
  out.push('commit;');
  return out.join('\n') + '\n';
}
