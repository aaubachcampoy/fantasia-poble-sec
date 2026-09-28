# CE Apa Poble Sec Fantasy

Monorepo (pnpm + Turborepo). Decisiones y esquema: [`docs/PROPUESTA.md`](docs/PROPUESTA.md).

| Carpeta | Qué hay |
|---|---|
| `packages/core` | Tipos, fórmula de puntos y reglas de juego (TypeScript puro, con tests). Generador del seed. |
| `packages/db` | Tests de la base de datos (SQL = core, flujo completo, RLS), `seed:write` y `admin:grant`. |
| `supabase/` | Migraciones (esquema, reglas, RPC, RLS, cron), `seed.sql` generado y `config.toml`. |
| `handoff_apa_fantasy/` | Prototipos de diseño de referencia. |

## Comandos

```sh
pnpm install
pnpm test          # core siempre; los tests de BD solo si TEST_DATABASE_URL está definida
pnpm typecheck
```

### Tests de base de datos

Necesitan un Postgres 15+ vacío con un usuario que pueda crear bases de datos (no hace falta Supabase):

```sh
docker run -d --name apa-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/postgres pnpm test
```

Los tests crean una base de datos plantilla (`supabase/tests/shim.sql` imita lo mínimo de Supabase: `auth.users`, `auth.uid()` y los roles) y una copia por fichero de tests. La hora se simula con `apa.now` (solo en bases de datos de test).

### Supabase en local

```sh
npx supabase start          # aplica migraciones y seed.sql
npx supabase db reset       # desde cero
```

- El seed reproduce los datos del prototipo (semilla `20260927`): 20 equipos, 260 jugadores, J1–J4 cerradas y J5 en curso. Si cambia el generador: `pnpm --filter @apa/db seed:write` (un test comprueba que `seed.sql` esté al día).
- Hacer admin a alguien (tiene que haber entrado una vez en la app):
  `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm --filter @apa/db admin:grant persona@correo.cat`
- `private.tick()` se ejecuta cada minuto con `pg_cron`: bloqueo del sábado 09:00, pujas al cierre del mercado, caducidad de ofertas e intercambios y los 16 libres del día.
