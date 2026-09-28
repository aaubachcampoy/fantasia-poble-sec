import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { seedSql } from '../scripts/seed-sql.js';

export const TEMPLATE = 'apa_template';
const supabaseDir = fileURLToPath(new URL('../../../supabase/', import.meta.url));

/** Base de dades plantilla: shim de Supabase + migracions + seed. Cada fitxer de tests en fa una còpia. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn('\n[@apa/db] TEST_DATABASE_URL no definida: se salten els tests de base de dades.\n');
    return;
  }
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await admin.query(`drop database if exists ${TEMPLATE} with (force)`);
  await admin.query(`create database ${TEMPLATE}`);
  await admin.end();

  const u = new URL(url);
  u.pathname = '/' + TEMPLATE;
  const db = new pg.Client({ connectionString: u.toString() });
  await db.connect();
  const migrations = readdirSync(supabaseDir + 'migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const file of ['tests/shim.sql', ...migrations.map((f) => 'migrations/' + f)]) {
    try {
      await db.query(readFileSync(supabaseDir + file, 'utf8'));
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  // El seed.sql del repo ha d'estar al dia amb el generador.
  const committed = readFileSync(supabaseDir + 'seed.sql', 'utf8');
  if (committed !== seedSql()) throw new Error('supabase/seed.sql no està al dia: executa `pnpm --filter @apa/db seed:write`.');
  await db.query(committed);
  await db.end();
}
