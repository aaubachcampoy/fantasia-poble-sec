import { describe, expect, it } from 'vitest';
import { expectRule, hasDb, useDb } from './db.js';

describe.skipIf(!hasDb)('superfície d’API', () => {
  const db = useDb();

  it('només aquestes funcions són cridables des del client', async () => {
    const rows = await db.sql(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1`);
    expect(rows.map((r) => r.proname)).toEqual([
      'admin_close_matchday', 'admin_create_fixtures', 'admin_import_players', 'admin_remove_player',
      'admin_save_player', 'admin_save_sheet', 'admin_set_postponed',
      'cancel_offer', 'cancel_trade', 'create_league', 'is_admin', 'is_league_member', 'is_my_manager',
      'join_league', 'make_offer', 'market_listing', 'market_status', 'my_bid_rivals', 'pay_clause',
      'place_bid', 'propose_trade', 'respond_offer', 'respond_trade', 'sell_player', 'set_lineup', 'withdraw_bid',
    ]);
    const anon = await db.sql(`
      select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')`);
    expect(anon[0].n).toBe(0);
  });

  it('cap RPC d’admin funciona per a un usuari normal', async () => {
    const u = await db.createUser('normal@example.com');
    const calls: [string, unknown[]][] = [
      ['admin_close_matchday', [5]],
      ['admin_create_fixtures', [5]],
      ['admin_import_players', ['[]']],
      ['admin_remove_player', [1]],
      ['admin_save_player', [1, 'Nom Cognom', 1, 'MIG', 1]],
      ['admin_save_sheet', [85, 0, 0, '[]', true]],
      ['admin_set_postponed', [85, true]],
    ];
    for (const [fn, args] of calls) {
      await expectRule(db.as(u, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(', ')})`, args), 'FORBIDDEN');
    }
  });

  it('totes les taules tenen RLS', async () => {
    const rows = await db.sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });
});
