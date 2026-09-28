import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedSql } from './seed-sql.js';

const target = fileURLToPath(new URL('../../../supabase/seed.sql', import.meta.url));
writeFileSync(target, seedSql());
console.log('Escrit', target);
