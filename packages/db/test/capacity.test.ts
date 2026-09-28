import { describe, expect, it } from 'vitest';
import { expectRule, hasDb, useDb } from './db.js';

describe.skipIf(!hasDb)('capacitat de les lligues', () => {
  const db = useDb();
  const join = async (i: number, code: string) => {
    const u = await db.createUser(`u${i}-${code}@example.com`);
    return db.as(u, `select * from public.join_league($1, $2)`, [code, `Equip ${i}`]);
  };
  const create = async (max: number) => {
    const u = await db.createUser(`owner-${max}@example.com`);
    const [r] = await db.as(u, `select * from public.create_league('Lliga', 'Equip 0', $1)`, [max]);
    return r.code as string;
  };

  it('mida no permesa', async () => {
    const u = await db.createUser('x@example.com');
    await expectRule(db.as(u, `select * from public.create_league('Lliga', 'Equip', 12)`), 'INVALID', 'Màxim de participants: 10, 20, 30 o 50.');
  });

  it('lliga plena', async () => {
    const code = await create(10);
    for (let i = 1; i < 10; i++) await join(i, code);
    await expectRule(join(10, code), 'LEAGUE_FULL', 'Aquesta lliga ja és plena.');
  });

  // 20 equips × 4 DEF (o MIG) = 80, i el repartiment en dona 5 a cadascú: com a màxim 16 mànagers per lliga.
  // (El límit de 3 per equip pot fer que l'últim ja no hi càpiga.)
  it('amb el seed (13 jugadors per equip) una lliga admet uns 16 mànagers', async () => {
    const code = await create(20);
    let n = 1;
    let err: any = null;
    while (!err && n < 20) {
      err = await join(n, code).then(() => null, (e) => e);
      if (!err) n++;
    }
    expect(err?.detail).toBe('NO_PLAYERS');
    expect(err.message).toBe('No queden prou jugadors lliures en aquesta lliga.');
    expect(n).toBeGreaterThanOrEqual(15);
    expect(n).toBeLessThanOrEqual(16);
    // L'error desfà l'alta: no queda cap mànager a mitges.
    const [{ c }] = await db.sql(`select count(*)::int c from public.managers m join public.leagues l on l.id = m.league_id where l.code = $1`, [code]);
    expect(c).toBe(n);
  });
});
