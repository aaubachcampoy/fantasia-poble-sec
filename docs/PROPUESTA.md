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

## 4. Decisiones (aprobadas: «4 suplentes, haz caso al prototipo y decide tú»)

1. **Banquillo:** 4 suplentes (1 POR, 1 DEF, 1 MIG, 1 DAV). El resto de la plantilla queda en reserva.
2. **Calendario (hora de Madrid):** mercado abierto de lunes 00:00 a viernes 23:59. Sábado y domingo cerrado. Alineaciones bloqueadas desde el sábado 09:00 hasta que reabre el mercado.
3. **Reapertura:** el mercado solo reabre si la jornada anterior está cerrada. Si el lunes a las 00:00 el admin aún no la ha cerrado, abre en el momento en que la cierre. Mientras no la cierre, las alineaciones siguen bloqueadas (también el sábado antes de las 09:00).
4. **Cobro:** automático al cerrar la jornada (0,1M por punto, capitán incluido, más 3M / 2M / 1M al podio de cada liga). En la app, la tarjeta de premios es solo informativa. Empate en el podio: se desempata por quien entró antes en la liga.
5. **Precio al cerrar la jornada:** `nuevo = precio + (puntos − 5) × 0,05 + demanda`, con `demanda = 0,3 × (proporción de ligas en que el jugador tiene propietario, redondeada a 2 decimales) − 0,1` (entre −0,1M y +0,2M). Se redondea a 0,1M y nunca baja de `inicial − 1,0M`. Si no juega, suma 0 puntos. El precio es global.
6. **Mercado y navegación como en el prototipo:** pestañas Lliures / Pujes / Ofertes; intercambios en MÉS; navegación EQUIP · MERCAT · JORNADA · LLIGA · MÉS · NORMES.
7. **Resolución de pujas:** por jugador gana la más alta y, en empate, la más antigua. Si el ganador ya no cumple saldo o límites, pasa a la siguiente puja. Se resuelven de mayor a menor importe para que el saldo reservado sea coherente.
8. **Importar CSV:** columnas `nom, equip, posicio, dorsal` (`equip` = nombre corto, p. ej. `S12 A`). Si hay filas con error, no se importa ninguna.
9. **Admins:** rol `admin` asignado con un script (`pnpm admin:grant <email>`). Nadie se lo puede dar desde la app.
10. **Estados vacíos, de carga y de error:** siguen el estilo de los estados vacíos que ya existen en los prototipos. Los documento al hacer cada pantalla.

## 5. Plan

- [x] Fase 2: `packages/core` (fórmula, reglas, mercado, precios, reparto, PRNG) con tests.
- [x] Fase 3: migraciones SQL, RLS, cron y seed.
- [ ] Fase 4: admin.
- [ ] Fase 5: app de jugadores.

## 6. Decisiones de la fase 3

- **Borradores invisibles:** el acta en borrador (`match_sheets`, `player_stats`) solo la ve el admin. Al publicar se copia a `player_points` y a `fixtures.goals_*`, que es lo que ven las ligas. Si se corrige un partido ya publicado, los mánagers siguen viendo la versión anterior hasta que se vuelve a publicar.
- **Alineación congelada:** el sábado a las 09:00 se guarda una foto de cada alineación (`lineup_snapshots`) y la puntuación sale de esa foto. Quien entra en una liga después del bloqueo no puntúa esa jornada.
- **Resultados solo con la jornada empezada:** el admin no puede publicar resultados antes del bloqueo del sábado. Una vez cerrada la jornada, los resultados quedan bloqueados.
- **Baja de un jugador:** el mánager que lo tenía cobra su precio actual. Se anulan las pujas, ofertas e intercambios en los que aparece.
- **Cambio de posición de un jugador:** sale de su hueco en la alineación y se recoloca según la nueva posición.
- **Ofertas e intercambios:** el dinero no se reserva al hacer la propuesta. Se comprueba el saldo al aceptarla. Solo reservan dinero las pujas.
- **Pujas:** modificar una puja conserva su antigüedad para el desempate. Se puede modificar aunque el jugador ya no salga en el mercado de ese día.
- **Mercado diario:** los 16 jugadores libres son los mismos para todos los mánagers de una liga y distintos entre ligas.
- **Hora de Madrid:** todas las fechas se calculan en hora de Madrid, con el cambio de hora incluido. `private.tick()` es idempotente: si el cron se salta una ejecución, la siguiente hace lo pendiente.

## 7. Pendiente de decidir: capacidad de las ligas

Con 13 jugadores por equipo (4 DEF y 4 MIG), una liga admite **como máximo unos 16 mánagers**: cada reparto se lleva 5 DEF y 5 MIG de 80. Los tamaños 20 / 30 / 50 del diseño no se pueden llenar; el mánager que ya no cabe recibe «No queden prou jugadors lliures en aquesta lliga». Opciones:

1. Limitar el tamaño a lo que permita la plantilla real del club. Cada mánager necesita 2 POR, 5 DEF, 5 MIG y 3 DAV, así que el máximo lo marca la posición con menos jugadores en el club.
2. Repartir menos jugadores cuando la liga es grande.
3. Permitir que un mismo jugador esté en varios equipos de una liga (cambia la regla «un propietario por liga»).
