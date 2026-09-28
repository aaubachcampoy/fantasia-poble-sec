import { managerPoints, nextPrice, playerPoints, type Position } from '@apa/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { expectDenied, expectRule, hasDb, useDb } from './db.js';

// Hora de Madrid (CEST, UTC+2).
const MON = '2026-09-28T10:00:00+02:00';
const TUE = '2026-09-29T10:00:00+02:00';
const FRI = '2026-10-02T23:59:00+02:00';
const SAT00 = '2026-10-03T00:00:30+02:00';
const SAT10 = '2026-10-03T10:00:00+02:00';
const MON2 = '2026-10-05T10:00:00+02:00';
const TUE2 = '2026-10-06T10:00:00+02:00';

interface Owned {
  player_id: string;
  team_id: string;
  position: Position;
  price: number;
}

describe.skipIf(!hasDb)('una setmana de Fantasy APA', () => {
  const db = useDb();
  let admin: string, ana: string, bernat: string, carla: string;
  let league: string, code: string, mAna: string, mBernat: string;

  const rpc = async (uid: string, fn: string, ...args: unknown[]) =>
    db.as(uid, `select * from public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')})`, args);
  const squad = (m: string) =>
    db.sql<Owned>(
      `select o.player_id::text, p.team_id::text, p.position::text as position, p.price::float8 as price
       from public.ownership o join public.players p on p.id = o.player_id where o.manager_id = $1 order by p.id`,
      [m],
    );
  const lineup = async (m: string) =>
    (await db.sql(`select slots::text[] as slots, captain_id::text from public.lineups where manager_id = $1`, [m]))[0] as {
      slots: (string | null)[];
      captain_id: string | null;
    };
  const balance = async (m: string) => Number((await db.sql(`select balance from public.managers where id = $1`, [m]))[0].balance);
  const setBalance = (m: string, b: number) => db.sql(`update public.managers set balance = $2 where id = $1`, [m, b]);
  const listed = async (uid: string, m: string) => (await rpc(uid, 'market_listing', m)).map((r) => String(r.market_listing));
  const info = (ids: string[]) =>
    db.sql<Owned>(`select id::text as player_id, team_id::text, position::text as position, price::float8 as price from public.players where id = any($1::bigint[]) order by price, id`, [ids]);
  // El repartiment és aleatori: tria jugadors que el mànager pot incorporar (límit per equip i plantilla).
  const fits = async (p: Owned, m: string, outgoing?: Owned) => {
    const sq = (await squad(m)).filter((q) => q.player_id !== outgoing?.player_id);
    return sq.filter((q) => q.team_id === p.team_id).length < 3 && sq.length < 18;
  };
  const pickFor = async (cands: Owned[], ...ms: string[]) => {
    for (const c of cands) if ((await Promise.all(ms.map((m) => fits(c, m)))).every(Boolean)) return c;
    throw new Error('cap candidat vàlid');
  };
  const pickPair = async (mine: Owned[], theirs: Owned[], mA: string, mB: string) => {
    for (const give of mine) for (const get of theirs) if ((await fits(get, mA, give)) && (await fits(give, mB, get))) return { give, get };
    throw new Error('cap parella vàlida');
  };

  beforeAll(async () => {
    admin = await db.createUser('admin@apa.cat', 'Admin Club');
    ana = await db.createUser('ana@example.com', 'Ana');
    bernat = await db.createUser('bernat@example.com');
    carla = await db.createUser('carla@example.com', 'Carla');
    await db.sql(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  });

  it('perfil automàtic en registrar-se', async () => {
    const rows = await db.sql(`select display_name, role from public.profiles where id = any($1::uuid[]) order by display_name`, [[ana, bernat]]);
    expect(rows).toEqual([
      { display_name: 'Ana', role: 'player' },
      { display_name: 'bernat', role: 'player' },
    ]);
  });

  describe('dilluns: jornada 5 encara oberta', () => {
    beforeAll(() => db.at(MON));

    it('mercat tancat i alineacions bloquejades', async () => {
      const [s] = await rpc(ana, 'market_status');
      expect(s).toMatchObject({ market_open: false, lineup_locked: true, matchday_number: 5 });
    });

    it('crear una lliga fa el repartiment de 15', async () => {
      const [r] = await rpc(ana, 'create_league', 'Penya del Sortidor', 'Les Tres Xemeneies', 20);
      ({ league_id: league, code, manager_id: mAna } = r);
      expect(code).toMatch(/^APA-[A-HJ-NP-Z2-9]{4}$/);
      const sq = await squad(mAna);
      expect(sq).toHaveLength(15);
      const count = (pos: Position) => sq.filter((p) => p.position === pos).length;
      expect([count('POR'), count('DEF'), count('MIG'), count('DAV')]).toEqual([2, 5, 5, 3]);
      const perTeam = new Map<string, number>();
      sq.forEach((p) => perTeam.set(p.team_id, (perTeam.get(p.team_id) ?? 0) + 1));
      expect(Math.max(...perTeam.values())).toBeLessThanOrEqual(3);
      expect(await balance(mAna)).toBe(0);
    });

    it('alineació inicial: 4-4-2 + 4 suplents, capità el més car de l’onze', async () => {
      const sq = await squad(mAna);
      const l = await lineup(mAna);
      expect(l.slots.every((s) => s != null)).toBe(true);
      const pos = (id: string) => sq.find((p) => p.player_id === id)!.position;
      expect(l.slots.map((id) => pos(id!)).join(',')).toBe('POR,DEF,DEF,DEF,DEF,MIG,MIG,MIG,MIG,DAV,DAV,POR,DEF,MIG,DAV');
      const xiPrices = l.slots.slice(0, 11).map((id) => sq.find((p) => p.player_id === id)!.price);
      expect(sq.find((p) => p.player_id === l.captain_id)!.price).toBe(Math.max(...xiPrices));
    });

    it('no es pot vendre ni canviar l’alineació', async () => {
      const sq = await squad(mAna);
      await expectRule(rpc(ana, 'sell_player', mAna, sq[0]!.player_id), 'MARKET_CLOSED', 'El mercat és tancat fins dilluns.');
      const l = await lineup(mAna);
      await expectRule(rpc(ana, 'set_lineup', mAna, l.slots, l.captain_id), 'LINEUP_LOCKED');
    });

    it('només l’admin pot tancar, i no sense tots els partits', async () => {
      await expectRule(rpc(ana, 'admin_close_matchday', 5), 'FORBIDDEN');
      await expectRule(rpc(admin, 'admin_close_matchday', 5), 'PENDING', 'Falten 4 partits.');
    });

    it('els mànagers no veuen les actes en esborrany; l’admin sí', async () => {
      await db.sql(`insert into public.match_sheets (fixture_id, goals_for, goals_against) values (85, 9, 9)`);
      expect(await db.as(ana, `select * from public.match_sheets`)).toHaveLength(0);
      expect(await db.as(ana, `select * from public.player_stats`)).toHaveLength(0);
      expect((await db.as(ana, `select count(*)::int n from public.player_points`))[0].n).toBeGreaterThan(1000);
      expect((await db.as(admin, `select count(*)::int n from public.match_sheets`))[0].n).toBeGreaterThan(90);
      await db.sql(`delete from public.match_sheets where fixture_id = 85`);
    });

    it('l’admin publica els 4 que falten i tanca la J5: preus nous i J6', async () => {
      const before = await db.sql(`select p.id, p.price::float8 price, t.age from public.players p join public.teams t on t.id = p.team_id order by p.id`);
      const pending = await db.sql(`select f.id, f.team_id from public.fixtures f where matchday_id = 5 and status = 'pending' order by id`);
      expect(pending).toHaveLength(4);
      for (const f of pending) {
        const roster = await db.sql(`select id from public.players where team_id = $1 order by id`, [f.team_id]);
        const stats = roster.map((p, i) => ({ player_id: p.id, minutes: i % 5 === 0 ? 0 : 2, goals: i === 10 ? 1 : 0, assists: 0, yellow: 0, red: 0, coach: 1 }));
        await rpc(admin, 'admin_save_sheet', f.id, 1, 0, JSON.stringify(stats), true);
      }
      const out = (await rpc(admin, 'admin_close_matchday', 5))[0].admin_close_matchday;
      const [md6] = await db.sql(`select id, number, sat_date::text, status from public.matchdays where id = $1`, [out.next_matchday_id]);
      expect(md6).toMatchObject({ number: 6, sat_date: '2026-10-03', status: 'upcoming' });
      expect((await db.sql(`select current_matchday_id from public.seasons`))[0].current_matchday_id).toBe(md6.id);

      // Preus: rendiment + demanda (1 lliga; els 15 de l'Ana hi tenen propietari).
      const pts = new Map((await db.sql(`select player_id, sum(points)::int p from public.player_points where matchday_id = 5 group by 1`)).map((r) => [r.player_id, r.p]));
      const owned = new Set((await squad(mAna)).map((p) => p.player_id));
      const after = new Map((await db.sql(`select id, price::float8 price from public.players`)).map((r) => [r.id, r.price]));
      for (const p of before) {
        expect(after.get(p.id), p.id).toBe(nextPrice({ price: p.price, teamAge: p.age, points: pts.get(p.id) ?? 0, ownedRatio: owned.has(p.id) ? 1 : 0 }));
      }
      expect((await db.sql(`select count(*)::int n from public.price_history where matchday_id = 5`))[0].n).toBe(260);
    });
  });

  describe('dimarts: mercat obert', () => {
    beforeAll(() => db.at(TUE));

    it('el mercat ha reobert', async () => {
      const [s] = await rpc(ana, 'market_status');
      expect(s).toMatchObject({ market_open: true, lineup_locked: false, matchday_number: 6 });
    });

    it('unir-se amb el codi (amb espais i minúscules)', async () => {
      const [r] = await rpc(bernat, 'join_league', `  ${code.toLowerCase()} `, 'Montjuïc United');
      expect(r.league_id).toBe(league);
      mBernat = r.manager_id;
      const a = new Set((await squad(mAna)).map((p) => p.player_id));
      expect((await squad(mBernat)).filter((p) => a.has(p.player_id))).toEqual([]);
      await expectRule(rpc(bernat, 'join_league', code, 'Una altra'), 'ALREADY_MEMBER');
      await expectRule(rpc(carla, 'join_league', 'APA-0000', 'X'), 'BAD_CODE', 'No hi ha cap lliga amb aquest codi.');
    });

    it('RLS: cadascú veu la seva lliga, i només el seu', async () => {
      expect(await db.as(carla, `select * from public.leagues`)).toHaveLength(0);
      expect(await db.as(carla, `select * from public.ownership`)).toHaveLength(0);
      expect(await db.as(bernat, `select * from public.managers`)).toHaveLength(2);
      expect(await db.as(bernat, `select * from public.ownership`)).toHaveLength(30);
      expect(await db.as(bernat, `select * from public.lineups`)).toHaveLength(1);
      const table = await db.as(bernat, `select team_name, display_name from public.league_table order by team_name`);
      expect(table).toEqual([
        { team_name: 'Les Tres Xemeneies', display_name: 'Ana' },
        { team_name: 'Montjuïc United', display_name: 'bernat' },
      ]);
    });

    it('RLS: no es poden fer trampes escrivint directament', async () => {
      await expectDenied(db.as(ana, `update public.managers set balance = 999 where id = $1`, [mAna]));
      await expectDenied(db.as(ana, `update public.profiles set role = 'admin' where id = $1`, [ana]));
      await expectDenied(db.as(ana, `insert into public.ownership (league_id, player_id, manager_id, acquired_via) values ($1, 1, $2, 'deal')`, [league, mAna]));
      await expectDenied(db.as(ana, `update public.players set price = 1`));
      await expectDenied(db.as(null, `select * from public.players`));
      await expectDenied(db.as(ana, `select private.tick()`));
      // Canviar el nom del seu equip sí; el d'un altre, no (RLS: 0 files).
      await db.as(ana, `update public.managers set team_name = 'Xemeneies FC' where id = $1`, [mAna]);
      await db.as(ana, `update public.managers set team_name = 'Hackejat' where id = $1`, [mBernat]);
      const names = await db.sql(`select team_name from public.managers order by joined_at`);
      expect(names.map((r) => r.team_name)).toEqual(['Xemeneies FC', 'Montjuïc United']);
    });

    it('RPC d’una altra lliga o d’un altre mànager: denegat', async () => {
      await expectRule(rpc(carla, 'market_listing', mAna), 'NOT_MEMBER');
      await expectRule(rpc(bernat, 'sell_player', mAna, (await squad(mAna))[0]!.player_id), 'NOT_MEMBER');
    });

    it('vendre: cobres el preu i surt de l’alineació (si era capità, sense capità)', async () => {
      const l = await lineup(mAna);
      const cap = (await squad(mAna)).find((p) => p.player_id === l.captain_id)!;
      const [r] = await rpc(ana, 'sell_player', mAna, cap.player_id);
      expect(Number(r.sell_player)).toBe(cap.price);
      expect(await balance(mAna)).toBe(cap.price);
      const l2 = await lineup(mAna);
      expect(l2.captain_id).toBeNull();
      expect(l2.slots.filter((s) => s == null)).toHaveLength(1);
      expect(await squad(mAna)).toHaveLength(14);
      const [tx] = await db.as(ana, `select kind, amount::float8 amount from public.transactions`);
      expect(tx).toEqual({ kind: 'sale', amount: cap.price });
      expect(await db.as(bernat, `select * from public.transactions`)).toHaveLength(0);
    });

    let target: { id: string; price: number };

    it('mercat del dia: 16 lliures', async () => {
      const ids = await listed(ana, mAna);
      expect(ids).toHaveLength(16);
      expect(await listed(bernat, mBernat)).toEqual(ids);
      const owned = await db.sql(`select player_id::text from public.ownership where player_id = any($1::bigint[])`, [ids]);
      expect(owned).toEqual([]);
      const p = await pickFor(await info(ids), mAna, mBernat);
      target = { id: p.player_id, price: p.price };
    });

    it('pujes secretes: mínim el preu, saldo reservat', async () => {
      await setBalance(mAna, 10);
      await expectRule(rpc(ana, 'place_bid', mAna, target.id, target.price - 0.1), 'BID_BELOW_PRICE');
      await expectRule(rpc(ana, 'place_bid', mAna, target.id, 10.1), 'INSUFFICIENT_BALANCE', 'Saldo insuficient (10,1M).');
      await rpc(ana, 'place_bid', mAna, target.id, 9);
      expect(await balance(mAna)).toBe(10);
      // Només queda 1,0M disponible per a altres pujes.
      const otherId = (await listed(ana, mAna)).find((id) => id !== target.id)!;
      const [other] = await db.sql(`select price::float8 price from public.players where id = $1`, [otherId]);
      await expectRule(rpc(ana, 'place_bid', mAna, otherId, other.price), 'INSUFFICIENT_BALANCE');
      // Modificar la mateixa puja sí que pot fer servir aquells diners.
      await rpc(ana, 'place_bid', mAna, target.id, 9.5);
      const free = await db.sql(
        `select p.id::text from public.players p where p.active and p.id <> all($1::bigint[])
         and not exists (select 1 from public.ownership o where o.player_id = p.id) limit 1`,
        [await listed(ana, mAna)],
      );
      await expectRule(rpc(ana, 'place_bid', mAna, free[0].id, 9), 'NOT_LISTED');
    });

    it('les pujes no es veuen; només quantes n’hi ha més', async () => {
      await setBalance(mBernat, 20);
      await rpc(bernat, 'place_bid', mBernat, target.id, 12);
      expect(await db.as(ana, `select player_id::text, amount::float8 amount from public.bids`)).toEqual([{ player_id: target.id, amount: 9.5 }]);
      expect(await db.as(bernat, `select amount::float8 amount from public.bids`)).toEqual([{ amount: 12 }]);
      expect(await rpc(ana, 'my_bid_rivals', mAna)).toEqual([{ player_id: target.id, rivals: 1 }]);
    });

    it('clàusula: 1,5 × preu, saldo i límits', async () => {
      const y = await pickFor(await squad(mBernat), mAna);
      const clause = Math.round(y.price * 15) / 10;
      await setBalance(mAna, clause - 0.1 + 9.5); // 9,5M reservats per la puja
      await expectRule(rpc(ana, 'pay_clause', mAna, y.player_id), 'INSUFFICIENT_BALANCE');
      await setBalance(mAna, 60);
      const bBefore = await balance(mBernat);
      await rpc(ana, 'pay_clause', mAna, y.player_id);
      expect(await balance(mAna)).toBeCloseTo(60 - clause, 5);
      expect(await balance(mBernat)).toBeCloseTo(bBefore + clause, 5);
      expect((await squad(mAna)).some((p) => p.player_id === y.player_id)).toBe(true);
      expect((await lineup(mBernat)).slots).not.toContain(y.player_id);
    });

    it('clàusula: límit de plantilla i per equip (configurables)', async () => {
      const mine = await squad(mAna);
      const theirs = await squad(mBernat);
      expect(mine).toHaveLength(15);
      await db.sql(`update public.seasons set squad_max = 15`);
      await expectRule(rpc(ana, 'pay_clause', mAna, theirs[0]!.player_id), 'SQUAD_FULL', 'Plantilla plena (15). Ven un jugador abans.');
      await db.sql(`update public.seasons set squad_max = 18`);
      const y = theirs.find((p) => mine.some((q) => q.team_id === p.team_id))!;
      const n = mine.filter((q) => q.team_id === y.team_id).length;
      const [team] = await db.sql(`select name from public.teams where id = $1`, [y.team_id]);
      await db.sql(`update public.seasons set max_per_team = $1`, [n]);
      await expectRule(rpc(ana, 'pay_clause', mAna, y.player_id), 'TEAM_LIMIT', `Ja tens ${n} jugadors del ${team.name}.`);
      await db.sql(`update public.seasons set max_per_team = 3`);
    });

    it('ofertes: acceptar, rebutjar i qui les veu', async () => {
      const z = await pickFor(await squad(mAna), mBernat);
      await expectRule(rpc(bernat, 'make_offer', mBernat, (await squad(mBernat))[0]!.player_id, 3), 'INVALID');
      const [{ make_offer: offerId }] = await rpc(bernat, 'make_offer', mBernat, z.player_id, 3);
      expect(await db.as(ana, `select id from public.offers`)).toHaveLength(1);
      expect(await db.as(carla, `select id from public.offers`)).toHaveLength(0);
      await expectRule(rpc(bernat, 'respond_offer', offerId, true), 'NOT_FOUND');
      const [aB, bB] = [await balance(mAna), await balance(mBernat)];
      await rpc(ana, 'respond_offer', offerId, true);
      expect(await balance(mAna)).toBeCloseTo(aB + 3, 5);
      expect(await balance(mBernat)).toBeCloseTo(bB - 3, 5);
      expect((await squad(mBernat)).some((p) => p.player_id === z.player_id)).toBe(true);

      const w = await pickFor(await squad(mAna), mBernat);
      const [{ make_offer: o2 }] = await rpc(bernat, 'make_offer', mBernat, w.player_id, 2);
      await rpc(ana, 'respond_offer', o2, false);
      expect((await db.sql(`select status from public.offers where id = $1`, [o2]))[0].status).toBe('rejected');
    });

    it('intercanvis 1×1 amb diners', async () => {
      const { give, get } = await pickPair(await squad(mAna), await squad(mBernat), mAna, mBernat);
      await setBalance(mAna, 0.5 + 9.5);
      await expectRule(rpc(ana, 'propose_trade', mAna, mBernat, give.player_id, get.player_id, 1), 'INSUFFICIENT_BALANCE');
      await setBalance(mAna, 20);
      const [{ propose_trade: t }] = await rpc(ana, 'propose_trade', mAna, mBernat, give.player_id, get.player_id, 1);
      const [aB, bB] = [await balance(mAna), await balance(mBernat)];
      await rpc(bernat, 'respond_trade', t, true);
      expect(await balance(mAna)).toBeCloseTo(aB - 1, 5);
      expect(await balance(mBernat)).toBeCloseTo(bB + 1, 5);
      expect((await squad(mAna)).map((p) => p.player_id)).toContain(get.player_id);
      expect((await squad(mBernat)).map((p) => p.player_id)).toContain(give.player_id);
      expect((await lineup(mAna)).slots).not.toContain(give.player_id);
    });

    it('vendre un jugador cancel·la les propostes on surt', async () => {
      const { give, get } = await pickPair(await squad(mAna), await squad(mBernat), mAna, mBernat);
      const [{ propose_trade: t }] = await rpc(ana, 'propose_trade', mAna, mBernat, give.player_id, get.player_id, 0);
      await rpc(ana, 'sell_player', mAna, give.player_id);
      expect((await db.sql(`select status from public.trades where id = $1`, [t]))[0].status).toBe('cancelled');
      await expectRule(rpc(bernat, 'respond_trade', t, true), 'INVALID');
    });

    it('alineació: posicions, propietat i capità', async () => {
      const l = await lineup(mAna);
      const sq = await squad(mAna);
      const def = sq.find((p) => p.position === 'DEF')!.player_id;
      const bad1 = [...l.slots];
      bad1[0] = def;
      await expectRule(rpc(ana, 'set_lineup', mAna, bad1, null), 'INVALID', 'Jugador fora de la seva posició.');
      const bad2 = [...l.slots];
      bad2[0] = (await squad(mBernat)).find((p) => p.position === 'POR')!.player_id;
      await expectRule(rpc(ana, 'set_lineup', mAna, bad2, null), 'NOT_OWNER');
      const benchId = l.slots.slice(11).find((s) => s != null)!;
      await expectRule(rpc(ana, 'set_lineup', mAna, l.slots, benchId), 'INVALID', "El capità ha de ser a l'onze.");
      await expectRule(rpc(ana, 'set_lineup', mAna, l.slots.slice(1), null), 'INVALID');

      // Omple els buits amb la reserva i tria capità.
      const slots = [...l.slots];
      for (const p of sq.filter((q) => !slots.includes(q.player_id))) {
        const idx = { POR: [0, 11], DEF: [1, 2, 3, 4, 12], MIG: [5, 6, 7, 8, 13], DAV: [9, 10, 14] }[p.position].find((i) => slots[i] == null);
        if (idx != null) slots[idx] = p.player_id;
      }
      const cap = slots.slice(0, 11).find((s) => s != null)!;
      await rpc(ana, 'set_lineup', mAna, slots, cap);
      expect(await lineup(mAna)).toEqual({ slots, captain_id: cap });
    });

    it('l’admin crea els partits de la J6 però no hi pot entrar resultats encara', async () => {
      const [{ admin_create_fixtures: n }] = await rpc(admin, 'admin_create_fixtures', 6);
      expect(n).toBe(20);
      const [f5, f6] = await db.sql(`select is_home, day, kickoff::text from public.fixtures where team_id = 1 order by matchday_id desc limit 2`);
      expect(f5).toMatchObject({ is_home: false, day: 'sat', kickoff: '11:45:00' });
      expect(f6!.is_home).toBe(true);
      const [f] = await db.sql(`select id from public.fixtures where matchday_id = 6 and team_id = 1`);
      await expectRule(rpc(admin, 'admin_save_sheet', f.id, 1, 0, '[]', true), 'NOT_STARTED');
      await expectRule(rpc(admin, 'admin_create_fixtures', 6), 'INVALID');
    });

    it('una oferta pendent caduca en tancar el mercat', async () => {
      const x = await pickFor(await squad(mAna), mBernat);
      await rpc(bernat, 'make_offer', mBernat, x.player_id, 1);
    });
  });

  describe('cap de setmana', () => {
    it('divendres 23:59 encara no es resolen les pujes', async () => {
      db.at(FRI);
      await db.sql(`select private.tick()`);
      expect((await db.sql(`select count(*)::int n from public.bids where status = 'active'`))[0].n).toBe(2);
    });

    it('dissabte 00:00: guanya la puja més alta; caduquen ofertes', async () => {
      db.at(SAT00);
      const [aB, bB] = [await balance(mAna), await balance(mBernat)];
      await db.sql(`select private.tick()`);
      const bids = await db.sql(`select manager_id, status from public.bids order by amount`);
      expect(bids).toEqual([
        { manager_id: mAna, status: 'lost' },
        { manager_id: mBernat, status: 'won' },
      ]);
      expect(await balance(mAna)).toBe(aB);
      expect(await balance(mBernat)).toBeCloseTo(bB - 12, 5);
      expect((await db.sql(`select count(*)::int n from public.offers where status = 'expired'`))[0].n).toBe(1);
      const [s] = await rpc(ana, 'market_status');
      expect(s).toMatchObject({ market_open: false, lineup_locked: false });
    });

    it('dissabte 09:00: alineacions congelades', async () => {
      db.at(SAT10);
      await db.sql(`select private.tick()`);
      const snaps = await db.as(ana, `select manager_id, slots::text[] as slots, captain_id::text from public.lineup_snapshots order by manager_id`);
      expect(snaps).toHaveLength(2);
      expect(snaps.find((s) => s.manager_id === mAna)).toMatchObject(await lineup(mAna));
      const l = await lineup(mAna);
      await expectRule(rpc(ana, 'set_lineup', mAna, l.slots, l.captain_id), 'LINEUP_LOCKED');
    });

    it('resultats de la J6: punts dels mànagers amb capità ×2', async () => {
      const fixtures = await db.sql(`select id, team_id from public.fixtures where matchday_id = 6 order by id`);
      const score = { goalsFor: 2, goalsAgainst: 0 };
      for (const f of fixtures) {
        const roster = await db.sql(`select id from public.players where team_id = $1 and active order by id`, [f.team_id]);
        const stats = roster.map((p, i) => ({ player_id: p.id, minutes: (i % 3) as 0 | 1 | 2, goals: i === 12 ? 2 : 0, assists: i === 7 ? 1 : 0, yellow: i === 4 ? 1 : 0, red: 0, coach: i % 4 }));
        await rpc(admin, 'admin_save_sheet', f.id, score.goalsFor, score.goalsAgainst, JSON.stringify(stats), String(f.team_id) !== '20');
      }
      // L'últim, ajornat.
      const last = fixtures.at(-1)!;
      await expectRule(rpc(admin, 'admin_close_matchday', 6), 'PENDING', 'Falten 1 partits.');
      await rpc(admin, 'admin_set_postponed', last.id, true);

      const stats = await db.sql(
        `select s.player_id::text, p.position::text as position, s.minutes, s.goals, s.assists, s.yellow, s.red, s.coach, f.status::text as status
         from public.player_stats s join public.players p on p.id = s.player_id join public.fixtures f on f.id = s.fixture_id where f.matchday_id = 6`,
      );
      const pts = new Map(stats.filter((s) => s.status === 'published').map((s) => [s.player_id, playerPoints(s.position, s, score).total]));
      for (const m of [mAna, mBernat]) {
        const [snap] = await db.sql(`select slots::text[] as slots, captain_id::text from public.lineup_snapshots where manager_id = $1`, [m]);
        const [row] = await db.as(ana, `select points from public.manager_scores where manager_id = $1 and matchday_id = 6`, [m]);
        expect(row.points).toBe(managerPoints(snap.slots.slice(0, 11), snap.captain_id, pts));
      }
    });
  });

  describe('dilluns: tancament de la J6', () => {
    it('diners de la jornada i podi', async () => {
      db.at(MON2);
      const scores = await db.sql(`select manager_id, points from public.manager_scores where matchday_id = 6`);
      const before = new Map(await Promise.all([mAna, mBernat].map(async (m) => [m, await balance(m)] as const)));
      await rpc(admin, 'admin_close_matchday', 6);
      const ranked = await db.sql(`select manager_id, rank, points, points_money::float8 pm, prize::float8 prize from public.manager_scores where matchday_id = 6 order by rank`);
      expect(ranked.map((r) => r.prize)).toEqual([3, 2]);
      for (const r of ranked) {
        const s = scores.find((x) => x.manager_id === r.manager_id)!;
        expect(r.pm).toBe(Math.round(Math.max(0, s.points)) / 10);
        expect(await balance(r.manager_id)).toBeCloseTo(before.get(r.manager_id)! + r.pm + r.prize, 5);
      }
      const kinds = await db.as(ana, `select kind from public.transactions where matchday_id = 6 order by kind`);
      expect(kinds.map((k) => k.kind)).toEqual(['matchday_points', 'matchday_prize']);
      await expectRule(rpc(admin, 'admin_save_sheet', 101, 0, 0, '[]', true), 'CLOSED');
    });

    it('dimarts el mercat torna a obrir', async () => {
      db.at(TUE2);
      const [s] = await rpc(ana, 'market_status');
      expect(s).toMatchObject({ market_open: true, lineup_locked: false, matchday_number: 7 });
    });
  });

  describe('gestió de jugadors (admin)', () => {
    it('alta: preu inicial segons l’equip', async () => {
      await expectRule(rpc(admin, 'admin_save_player', null, 'Pau', 1, 'MIG', 7), 'INVALID', 'Cal el nom complet.');
      const [{ admin_save_player: id }] = await rpc(admin, 'admin_save_player', null, 'Pau Nou Jugador', 1, 'MIG', 7);
      const [p] = await db.sql(`select price::float8 price from public.players where id = $1`, [id]);
      expect(p.price).toBe(6);
      await expectRule(rpc(ana, 'admin_save_player', null, 'Pau Nou Jugador', 1, 'MIG', 7), 'FORBIDDEN');
    });

    it('baixa: el propietari cobra el preu i surt de la plantilla', async () => {
      const x = (await squad(mAna))[0]!;
      const b = await balance(mAna);
      await rpc(admin, 'admin_remove_player', x.player_id);
      expect((await squad(mAna)).map((p) => p.player_id)).not.toContain(x.player_id);
      expect((await lineup(mAna)).slots).not.toContain(x.player_id);
      expect(await balance(mAna)).toBeCloseTo(b + x.price, 5);
    });

    it('canvi de posició: es recol·loca a l’alineació', async () => {
      const x = (await squad(mAna)).find((p) => p.position === 'DAV')!;
      const [pl] = await db.sql(`select name, team_id, shirt_number from public.players where id = $1`, [x.player_id]);
      await rpc(admin, 'admin_save_player', x.player_id, pl.name, pl.team_id, 'DEF', pl.shirt_number);
      const l = await lineup(mAna);
      const idx = l.slots.indexOf(x.player_id);
      expect(idx === -1 || [1, 2, 3, 4, 12].includes(idx)).toBe(true);
    });

    it('importar llista: tot o res', async () => {
      const n0 = (await db.sql(`select count(*)::int n from public.players`))[0].n;
      const bad = [
        { nom: 'Joan Pere Soler', equip: 'S12 A', posicio: 'DEF', dorsal: '4' },
        { nom: 'Solo', equip: 'S99', posicio: 'XXX', dorsal: '123' },
      ];
      const err = await rpc(admin, 'admin_import_players', JSON.stringify(bad)).catch((e) => e);
      expect(err.message).toBe("No s'ha importat cap jugador. Corregeix la llista.");
      expect(err.detail.split('\n')).toEqual([
        'Fila 2: cal el nom complet.',
        'Fila 2: equip «S99» desconegut.',
        'Fila 2: posició «XXX» (POR, DEF, MIG o DAV).',
        'Fila 2: dorsal «123».',
      ]);
      expect((await db.sql(`select count(*)::int n from public.players`))[0].n).toBe(n0);
      const good = [
        { nom: 'Joan Pere Soler', equip: 's12 a', posicio: 'def', dorsal: '4' },
        { nom: 'Laia Riera Font', equip: 'JUV A', posicio: 'POR', dorsal: '' },
      ];
      expect((await rpc(admin, 'admin_import_players', JSON.stringify(good)))[0].admin_import_players).toBe(2);
      const rows = await db.sql(`select p.name, t.short, p.position::text as position, p.shirt_number, p.price::float8 price from public.players p join public.teams t on t.id = p.team_id order by p.id desc limit 2`);
      expect(rows).toEqual([
        { name: 'Laia Riera Font', short: 'JUV A', position: 'POR', shirt_number: null, price: 8 },
        { name: 'Joan Pere Soler', short: 'S12 A', position: 'DEF', shirt_number: 4, price: 6 },
      ]);
    });
  });
});
