# Handoff: CE Apa Poble Sec Fantasy (app + admin)

## Overview
Fantasy del club CE Apa Poble Sec. Los socios juegan en ligas privadas con los jugadores reales de los 20 equipos del club. El panel de administración introduce las estadísticas reales de cada partido y de ahí salen los puntos.

## About the design files
Los archivos de `design/` son **prototipos HTML de referencia** (alta fidelidad) que muestran el aspecto y el comportamiento esperados. No son código de producción: hay que recrearlos en el stack elegido. Los datos son simulados con un generador pseudoaleatorio (semilla `20260927`) que puedes reutilizar para el seed.

- `Fantasy APA.dc.html`: app de jugadores (móvil).
- `Admin APA.dc.html`: panel de administración (desktop).
- `Fantasy APA (standalone).html`: la app de jugadores en un solo archivo, se abre sin servidor.
- `assets/`: `escut.png` (escudo), `avatar.svg` (avatar genérico sin foto), `bg-grain.png` (textura de fondo), `EASPORTS15.ttf` (fuente display).

Para abrir los `.dc.html`: `npx serve design` y abrir en el navegador. Toda la lógica está en la clase `Component` al final de cada archivo; úsala como especificación funcional.

## Fidelity
**Alta fidelidad.** Recrear colores, tipografía, espaciados y textos de forma exacta.

## Design tokens
- Fondo oscuro (app): `#0A0A0A`; niveles `#131313`, `#1C1C1C`. Textura `bg-grain.png` en cabeceras, bienvenida, reglamento y tarjetas.
- Fondo claro (admin): `#F1EDE6`; tarjetas `#FAF7F1` / `#FFFFFF`.
- Acento amarillo club: `#F2C314` · hover `#FFD83D` · pressed `#C99E00` · suave `#F7DC6F`.
- Líneas: blanco al 10% / 22% sobre oscuro; negro al 10% / 22% sobre claro.
- Texto terciario: `#6E6B66` (oscuro) / `#7E7B75` (claro). Positivo `#6fae6d`, negativo `#d0705f`.
- Tipografía: display **EA Sports** (`EASPORTS15.ttf`, solo ASCII; los caracteres acentuados caen a Montserrat 800), siempre en mayúsculas. Texto: **Montserrat** 400–700.
- Esquinas rectas (radio 0). Pills solo para chips/estados. Bordes 1px, activos 2–3px amarillo.
- Iconos: Lucide, trazo 1.5px. Sin emojis.
- Jugador sin foto: `avatar.svg` sobre `#1C1C1C`, con el escudo superpuesto en el pecho (left 59%, top 77%, 12% de ancho).

## App de jugadores — pantallas
1. **Onboarding**: crear liga (nombre de liga, nombre de equipo, tamaño) o unirse con código. Reparto animado de 15 jugadores (uno cada 140ms).
2. **Equip**: campo con formación 1-4-4-2 (onze) + banquillo (1 POR, 4 DEF, 4 MIG, 2 DAV) + reservas. Capitán marcado en amarillo (puntúa ×2). Tocar un jugador abre su ficha.
3. **Fitxa de jugador** (sheet): puntos por jornada (barras J1–J4), desglose de la última jornada, precio y tendencia, propietario. Acciones: fer capità, canvis, posar a l'onze, vendre, pagar clàusula, pujar.
4. **Mercat**: pestañas lliure / pujes / intercanvis; filtros por posición y categoría.
5. **Classificació**: 12 mánagers, total y puntos de la jornada.
6. **Reglament**: acordeón con las reglas.

## Reglas de juego
- Plantilla máx. **18**; máx. **3 jugadores del mismo equipo** del club (configurable).
- Onze 1-4-4-2 + banquillo de 11. Puntúa el onze; capitán ×2.
- Mercado abierto de lunes a sábado; **cerrado el domingo** (alineación bloqueada durante la jornada).
- Vender: cobras el precio de mercado al momento.
- Cláusula: pagar **precio ×1,5** para quitar un jugador a otro mánager (requiere saldo y cumplir límites).
- Pujas ciegas por jugadores libres; se resuelven al cierre del mercado; la mayor gana.
- Intercambios entre mánagers: jugador por jugador + dinero opcional; aceptar/rechazar.
- Precio base: 6M (≤ S12, fútbol 7) o 8M (S13+, fútbol 11) con variación según rendimiento.

## Fórmula de puntos (por partido)
Si no juega (minutos = 0) → 0. Si juega:
- Minutos: 1 (parte) o 2 (completo)
- Gol: POR 6 · DEF 6 · MIG 5 · DAV 4
- Asistencia: 3
- Porteria a zero (partido completo y 0 goles en contra): POR 4 · DEF 4 · MIG 1 · DAV 0
- Resultado: victoria 2 · empate 1 · derrota 0
- Amarilla −1 · Roja −3
- Valoración del entrenador: 0–3

## Admin — pantallas
Barra lateral: JORNADA · RESULTATS (badge con pendientes) · JUGADORS · EQUIPS.
1. **Jornada**: tabla de los 20 partidos (equipo, formato F7/F11, rival, día, hora, casa/fuera, estado PENDENT / ESBORRANY / PUBLICAT). Editable. Navegar entre jornadas. Título del partido siempre "APA vs {rival}".
2. **Resultats**: marcador + tabla de estadísticas por jugador (minutos 0/1/2, goles, asistencias, amarilla, roja, entrenador 0–3) con puntos calculados en vivo. Guardar como esborrany o publicar. Al publicar → recálculo en la app.
3. **Jugadors**: buscador, filtros por equipo y posición, alta/edición/baja (nombre, equipo, posición, dorsal, precio, foto).
4. **Equips**: los 20 equipos con categoría, formato y plantilla.
5. Cerrar jornada: bloquea resultados y avanza a la siguiente.

## Modelo de datos sugerido
`teams` (20) · `players` (equipo, posición, dorsal, precio, foto_url) · `matchdays` · `fixtures` (jornada, equipo, rival, casa, día, hora, estado, gf, ga) · `player_stats` (fixture, jugador, min, g, a, y, r, coach, pts) · `leagues` (nombre, código, tamaño, creador) · `managers` (usuario, liga, nombre de equipo, saldo) · `ownership` (liga, jugador, mánager) · `lineups` (mánager, jornada, slots, capitán) · `bids` · `trades` · `transactions` (historial de mercado).
Un jugador solo puede tener un propietario **por liga**. Roles: `admin` (club) y `player`.

## Screens → código de referencia
- App: `design/Fantasy APA.dc.html` (lógica: `build`, `canAdd`, `sell`, `payClause`, `swap`, `renderVals`).
- Admin: `design/Admin APA.dc.html` (lógica: `calc`, `setStat`, `setFix`, `renderVals`).
