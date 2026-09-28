import pg from 'pg';

// Ús: DATABASE_URL=postgresql://… pnpm --filter @apa/db admin:grant persona@exemple.cat
const email = process.argv[2];
const url = process.env.DATABASE_URL;
if (!email || !url) {
  console.error('Ús: DATABASE_URL=postgresql://… pnpm --filter @apa/db admin:grant <email>');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rowCount } = await client.query(
    `update public.profiles set role = 'admin' where id = (select id from auth.users where lower(email) = lower($1))`,
    [email],
  );
  if (!rowCount) {
    console.error(`No hi ha cap usuari amb el correu ${email}. Ha d'haver entrat almenys un cop a l'app.`);
    process.exitCode = 1;
  } else {
    console.log(`${email} ara és administrador.`);
  }
} finally {
  await client.end();
}
