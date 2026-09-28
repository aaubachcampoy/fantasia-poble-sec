import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect } from 'vitest';

export const url = process.env.TEST_DATABASE_URL;
export const hasDb = !!url;

export interface Db {
  /** Com a superusuari (postgres). */
  sql<T extends pg.QueryResultRow = any>(q: string, params?: unknown[]): Promise<T[]>;
  /** Com a usuari autenticat, amb RLS. */
  as<T extends pg.QueryResultRow = any>(uid: string | null, q: string, params?: unknown[]): Promise<T[]>;
  /** Hora simulada (ISO) per a totes les consultes següents. */
  at(iso: string): void;
  createUser(email: string, name?: string): Promise<string>;
}

/** Còpia nova de la plantilla per a aquest fitxer de tests. */
export function useDb(): Db {
  const name = 'apa_t_' + randomUUID().replace(/-/g, '').slice(0, 12);
  let pool: pg.Pool;
  let now: string | null = null;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database ${name} template apa_template`);
    await admin.query(`alter database ${name} set apa.fake_clock = 'on'`);
    await admin.end();
    const u = new URL(url!);
    u.pathname = '/' + name;
    pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
  });

  afterAll(async () => {
    await pool?.end();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });

  async function run(role: string | null, uid: string | null, q: string, params: unknown[] = []) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (now) await c.query(`select set_config('apa.now', $1, true)`, [now]);
      if (role) {
        await c.query(`set local role ${role}`);
        await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      }
      const r = await c.query(q, params);
      await c.query('commit');
      return r.rows;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    sql: (q, params) => run(null, null, q, params) as any,
    as: (uid, q, params) => run(uid ? 'authenticated' : 'anon', uid, q, params) as any,
    at: (iso) => {
      now = iso;
    },
    async createUser(email, name) {
      const [row] = await run(null, null, `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [
        email,
        name ? { name } : {},
      ]);
      return row.id as string;
    },
  };
}

/** Error de regla: comprova el codi (DETAIL) i, si es dona, el missatge. */
export async function expectRule(p: Promise<unknown>, code: string, message?: string | RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, `s'esperava l'error ${code}`).not.toBeNull();
  expect(err.detail, err.message).toBe(code);
  if (typeof message === 'string') expect(err.message).toBe(message);
  else if (message) expect(err.message).toMatch(message);
}

export async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied/);
}
