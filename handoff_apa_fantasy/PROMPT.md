# Prompt para Claude Code

Copia y pega esto en Claude Code, con la carpeta `handoff_apa_fantasy/` dentro del repo.

---

Vamos a construir **CE Apa Poble Sec Fantasy**: una app fantasy del club (20 equipos, del Prebenjamí S8 al Primer Equip) con dos caras conectadas a la misma base de datos:

1. **App de jugadores (mobile-first, PWA)**: los socios crean o se unen a ligas privadas, reciben un reparto inicial de plantilla, alinean su once, compran/venden en el mercado, pujan, hacen intercambios y compiten en una clasificación.
2. **Panel de administración (desktop)**: el club gestiona jornadas, introduce las estadísticas de cada partido, publica resultados y mantiene la base de jugadores y equipos.

Cuando el admin publica un resultado, los puntos se recalculan y aparecen en la app de jugadores en tiempo real.

## Referencias de diseño
En `handoff_apa_fantasy/design/` están los prototipos HTML (`Fantasy APA.dc.html`, `Admin APA.dc.html`). Son **referencias de alta fidelidad**, no código a reutilizar: recrea la UI con precisión (colores, tipografía, espaciados, textos en catalán) en el stack elegido. Lee `handoff_apa_fantasy/README.md` antes de empezar: contiene pantallas, reglas de juego, fórmula de puntos, modelo de datos y tokens. Para verlos, abre los `.dc.html` con un servidor local (`npx serve handoff_apa_fantasy/design`).

## Stack propuesto (ajústalo si ves algo mejor y dime por qué)
- Monorepo (pnpm workspaces): `apps/player` (Next.js, PWA), `apps/admin` (Next.js), `packages/core` (tipos, reglas de juego y cálculo de puntos compartidos, con tests), `packages/ui` (tokens y componentes base).
- **Supabase**: Postgres, Auth (magic link por email), Storage (fotos de jugadores), Realtime (clasificación y mercado en vivo), Row Level Security.
- Lógica sensible (pujas, resolución de mercado, cláusulas, intercambios, recálculo de puntos) en funciones de Postgres/Edge Functions, nunca solo en el cliente.
- Tareas programadas (cron) para: cierre y apertura del mercado, resolución de pujas, cambio de jornada.

## Cómo quiero que trabajes
1. Lee el README y los prototipos. Propón el esquema de base de datos y la estructura del monorepo y **espera mi OK** antes de programar.
2. Empieza por `packages/core`: fórmula de puntos y reglas (límite de 18 jugadores, máx. 3 por equipo del club, cláusula ×1,5, capitán ×2) con tests unitarios.
3. Luego migraciones SQL + RLS + seed con los 20 equipos y los datos de prueba.
4. Admin: jornada → resultados → publicar. Después la app de jugadores: onboarding/liga → equipo → mercado → clasificación → reglamento.
5. Commits pequeños por funcionalidad. Al terminar cada fase, dime qué queda y qué decisiones has tomado.
6. Si algo del diseño es ambiguo o falta un estado (vacío, error, carga), pregúntame antes de inventarlo.

Idioma de la interfaz: **catalán** (textos tal cual aparecen en los prototipos). Nunca emojis.
