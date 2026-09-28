# Propuesta: esquema de datos y estructura del monorepo

Fase 0 del plan de `handoff_apa_fantasy/PROMPT.md`. Pendiente de OK antes de programar.
Basada en `handoff_apa_fantasy/README.md` y en la lógica de `Fantasy APA.dc.html` y `Admin APA.dc.html`.

## 1. Stack

Mantengo el stack propuesto con dos ajustes:

| Pieza | Decisión | Por qué |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Turbo cachea `build`/`test`/`lint` por paquete; coste casi nulo. |
| Apps | `apps/player` y `apps/admin` en Next.js (App Router) | Despliegues y permisos separados; la app de jugadores como PWA. |
| Backend | Supabase (Postgres, Auth con magic link, Storage, Realtime, RLS) | Tal cual. |
| Lógica sensible | **Funciones de Postgres (`security definer`) + `pg_cron`**, no Edge Functions | Pujas, cláusulas, intercambios y recálculo necesitan transacciones y bloqueos de fila (`select … for update`). Dentro de Postgres son atómicos; en Edge Functions habría que reproducirlos. Edge Functions solo para lo que no es SQL (importar CSV, procesar fotos). |
| Reglas compartidas | `packages/core` en TypeScript puro con Vitest | Fuente de verdad de la fórmula. La versión SQL se valida contra `core` con los mismos casos de prueba (tabla de casos exportada a JSON y ejecutada en ambos lados). |
| Zona horaria | Todas las fechas en `timestamptz`; horarios de negocio en `Europe/Madrid` | Mercado a las 00:00, bloqueo a las 09:00, etc. |

## 2. Estructura del monorepo

```
/
├─ apps/
│  ├─ player/            Next.js PWA (móvil): onboarding, equip, mercat, jornada, lliga, més, normes
│  └─ admin/             Next.js (desktop): jornada, resultats, jugadors, equips
├─ packages/
│  ├─ core/              tipos, fórmula de puntos, reglas de plantilla/mercado, generador del seed (PRNG 20260927)
│  │  └─ test/           Vitest
│  ├─ ui/                tokens (colores, tipografía, fuentes EA Sports/Montserrat), componentes base, iconos Lucide
│  └─ db/                cliente Supabase tipado + tipos generados (`supabase gen types`)
├─ supabase/
│  ├─ migrations/        SQL: esquema, funciones, RLS, cron
│  ├─ seed.sql           generado por `packages/core` (no a mano)
│  └─ tests/             pgTAP: RLS y funciones de mercado
├─ handoff_apa_fantasy/  referencias de diseño (no se importan desde el código)
└─ docs/
```

## 3. Esquema de base de datos

Tipos: `position = 'POR'|'DEF'|'MIG'|'DAV'`, dinero en `numeric(6,1)` (millones con un decimal, como en el diseño).

### Club (global, lo gestiona el admin)

| Tabla | Columnas principales | Notas |
|---|---|---|
| `profiles` | `id` → `auth.users`, `display_name`, `role` (`admin`/`player`) | Rol en `app_metadata` también, para RLS barata. |
| `seasons` | `id`, `name` ('2026-27'), `max_per_team` (3), `squad_max` (18), `is_active` | Los límites configurables viven aquí. |
| `teams` | `id`, `season_id`, `name`, `short`, `age` (8–20), `format` (`F7` si age ≤ 12, si no `F11`, generado), `base_price` (6,0 / 8,0, generado), `sort` | 20 filas. |
| `players` | `id`, `team_id`, `name`, `position`, `shirt_number`, `photo_path`, `price`, `active` | Precio global (igual en todas las ligas). Baja = `active=false`. |
| `matchdays` | `id`, `season_id`, `number`, `sat_date`, `sun_date`, `status` (`upcoming`/`open`/`locked`/`closed`), `lineup_lock_at`, `closed_at` | Una jornada = un fin de semana. |
| `fixtures` | `id`, `matchday_id`, `team_id`, `rival`, `is_home`, `day` (`sat`/`sun`), `kickoff_time`, `status` (`pending`/`draft`/`published`), `goals_for`, `goals_against`, `postponed`, `published_at` | Única por (`matchday_id`, `team_id`). |
| `player_stats` | `fixture_id`, `player_id`, `minutes` (0/1/2), `goals`, `assists`, `yellow` (0/1), `red` (0/1), `coach` (0–3), `points`, `breakdown` (jsonb) | `points` lo calcula la función de publicación, no el cliente. |
| `price_history` | `player_id`, `matchday_id`, `price`, `delta` | Tendencia de la ficha. |

### Ligas (todo va con `league_id`)

| Tabla | Columnas principales | Notas |
|---|---|---|
| `leagues` | `id`, `season_id`, `name`, `code` (`APA-XXXX`, único), `max_managers` (10/20/30/50), `created_by` | |
| `managers` | `id`, `league_id`, `user_id`, `team_name`, `balance` (≥ 0), `joined_matchday` | Único por (`league_id`, `user_id`). |
| `ownership` | `league_id`, `player_id`, `manager_id`, `acquired_via`, `acquired_at` | PK (`league_id`, `player_id`): un propietario por liga. |
| `lineups` | `manager_id`, `matchday_id`, `captain_id`, `slots` (jsonb: 11 onze + suplentes), `locked_at` | Al bloquear se congela la fila de esa jornada; la puntuación usa esa foto. Reserva = propios fuera de `slots`. |
| `manager_scores` | `manager_id`, `matchday_id`, `points`, `rank`, `money_earned`, `prize` | Alimenta la clasificación (Realtime). |
| `market_listings` | `league_id`, `market_date`, `player_id` | 16 jugadores libres al día por liga. |
| `bids` | `id`, `league_id`, `manager_id`, `player_id`, `amount`, `created_at`, `status` (`active`/`won`/`lost`/`withdrawn`) | Secretas: RLS solo al autor; el recuento de rivales sale de una función. |
| `offers` | `id`, `league_id`, `from_manager`, `to_manager`, `player_id`, `amount`, `status`, `expires_at` | Ofertas de compra entre mánagers (pestaña «Ofertes»). |
| `trades` | `id`, `league_id`, `from_manager`, `to_manager`, `give_player`, `get_player`, `cash` (con signo), `status`, `expires_at` | Intercambio 1×1. |
| `transactions` | `id`, `league_id`, `manager_id`, `kind`, `amount` (con signo), `player_id`, `ref_id`, `created_at` | Libro mayor; `managers.balance` es la caché y se comprueba contra la suma. |

### Funciones (RPC, `security definer`, validan con las reglas de `core`)

- Jugadores: `create_league`, `join_league` (reparte 15: 2/5/5/3, máx. 3 por equipo, solo libres de esa liga), `set_lineup`, `set_captain`, `sell_player`, `pay_clause`, `place_bid`, `withdraw_bid`, `make_offer`, `respond_offer`, `propose_trade`, `respond_trade`.
- Admin: `create_matchday_fixtures`, `save_stats` (esborrany), `publish_fixture` (calcula puntos y los propaga a todas las ligas), `close_matchday` (precios, dinero, premios de podio, siguiente jornada).
- Cron (`pg_cron`, hora de Madrid): nuevo mercado diario a las 00:00, resolución de pujas y caducidad de intercambios/ofertas al cierre, bloqueo de alineaciones el sábado a las 09:00.

### RLS, en resumen

- Club (`teams`, `players`, `fixtures`, `player_stats` publicados): lectura para cualquier usuario autenticado; escritura solo `admin`. Stats en `draft` solo las ve el admin.
- Liga: lectura si eres mánager de esa liga; escritura solo mediante RPC (sin `insert/update` directo).
- `bids`: cada uno ve solo las suyas.
- Fotos: bucket privado con URLs firmadas (son menores).

## 4. Discrepancias entre README y prototipos

En estos puntos el README y el prototipo dicen cosas distintas, o falta algún dato. Necesito una decisión antes de fijarlos en `core`:

1. **Banquillo.** El README dice banquillo de 11 (1 POR, 4 DEF, 4 MIG, 2 DAV). El prototipo y su reglamento dicen 4 suplentes (1 por posición) y el resto en reserva. Propongo 4 suplentes, como en el prototipo.
2. **Calendario del mercado.** El README dice «abierto de lunes a sábado, cerrado el domingo». El prototipo dice que abre el lunes a las 00:00, cierra el viernes a las 23:59 y que la alineación se bloquea el sábado a las 09:00. Propongo lo del prototipo.
3. **Reapertura.** ¿El mercado reabre el lunes a las 00:00 aunque el admin aún no haya cerrado la jornada, o espera al cierre?
4. **Cobro de la jornada.** En el admin, al cerrar la jornada se paga automáticamente. En la app hay un botón «Cobrar». Propongo pago automático y que la tarjeta solo informe.
5. **Precio tras la jornada.** El prototipo usa `precio + (puntos − 5) × 0,05`, con mínimo `inicial − 1,0M`. El reglamento añade «y cuántos mánagers lo quieren». ¿Añado un factor de demanda (p. ej. % de ligas donde tiene propietario o pujas)? El precio es global, no por liga.
6. **Ofertas de compra.** Existen en el prototipo (pestaña «Ofertes») pero el README no las nombra. En el mercado, el README habla de la pestaña «intercanvis» y el prototipo tiene «Lliures / Pujes / Ofertes», con los intercambios en «Més». Propongo seguir el prototipo.
7. **Navegación de la app.** El prototipo tiene 6 pestañas: EQUIP · MERCAT · JORNADA · LLIGA · MÉS · NORMES. El README solo nombra algunas. Propongo las 6 del prototipo.
8. **Estados que faltan en el diseño**: carga, error de red, código de liga inválido, liga llena, mánager nuevo que entra a mitad de temporada. Los diseñaré en su momento.
9. **Alta de jugadores:** «Importar llista» (CSV). ¿Qué columnas tiene la hoja real del club?
10. **Admins:** ¿cómo se crean? Propongo marcar el rol a mano en Supabase o con un script de semilla con tu email.

## 5. Siguiente paso

Con tu OK, empiezo por `packages/core`: fórmula de puntos, reglas de plantilla (18, 3 por equipo, 2/5/5/3 en el reparto), cláusula ×1,5, capitán ×2, precio y generador del seed. Todo con tests.
