import type { Position } from './constants.js';
import { createRng } from './rng.js';
import { basePrice } from './teams.js';

/**
 * Dades de prova: mateix generador i mateix ordre de crides que `build()` de
 * `design/Admin APA.dc.html` (llavor 20260927), perquè el seed coincideixi amb el prototip.
 */

export type SeedDay = 'sat' | 'sun';

export interface SeedFixture {
  rival: string;
  isHome: boolean;
  day: SeedDay;
  kickoff: string;
}

export interface SeedTeam {
  name: string;
  age: number;
  short: string;
  /** Partit de la J5 (el del prototip). */
  j5: SeedFixture;
  /** Resultats J1–J5 (gols APA, gols rival). */
  results: { goalsFor: number; goalsAgainst: number }[];
}

export interface SeedStats {
  minutes: 0 | 1 | 2;
  goals: number;
  assists: number;
  yellow: 0 | 1;
  red: 0;
  coach: number;
}

export interface SeedPlayer {
  name: string;
  team: number;
  position: Position;
  number: number;
  price: number;
  /** J1–J5. */
  stats: SeedStats[];
}

const T: [string, number, string, string, 0 | 1, 'Dissabte' | 'Diumenge', string][] = [
  ['Prebenjamí S8', 8, 'S8', 'Sant Andreu', 1, 'Dissabte', '11:45'],
  ['Benjamí S9 A', 9, 'S9 A', 'Barcino', 0, 'Dissabte', '10:15'],
  ['Benjamí S10 A', 10, 'S10 A', 'Sant Ignasi', 1, 'Dissabte', '10:30'],
  ['Aleví S11 A', 11, 'S11 A', 'Premier BCN', 0, 'Dissabte', '10:30'],
  ['Aleví S11 B', 11, 'S11 B', 'Parc', 0, 'Diumenge', '17:00'],
  ['Aleví S12 A', 12, 'S12 A', 'At. Hospitalense', 0, 'Diumenge', '10:15'],
  ['Aleví S12 B', 12, 'S12 B', 'At. Hospitalense', 0, 'Dissabte', '12:15'],
  ['Infantil S13 A', 13, 'S13 A', 'Barça', 0, 'Dissabte', '16:00'],
  ['Infantil S14 A', 14, 'S14 A', 'Fund. Hospitalet', 0, 'Dissabte', '17:45'],
  ['Infantil S14 B', 14, 'S14 B', 'Barcino', 1, 'Dissabte', '09:00'],
  ['Cadet S15 A', 15, 'S15 A', 'Can Buxeres', 1, 'Dissabte', '10:30'],
  ['Cadet S15 B', 15, 'S15 B', 'Vila Olímpica', 0, 'Dissabte', '14:15'],
  ['Cadet S16 A', 16, 'S16 A', 'Sant Ignasi', 1, 'Diumenge', '10:00'],
  ['Cadet S16 B', 16, 'S16 B', 'Sarrià', 0, 'Diumenge', '13:00'],
  ['Juvenil A', 18, 'JUV A', 'Badalona', 1, 'Dissabte', '15:30'],
  ['Juvenil B', 18, 'JUV B', 'Congrés', 0, 'Diumenge', '18:00'],
  ['Juvenil C', 18, 'JUV C', 'Montañesa', 0, 'Dissabte', '15:30'],
  ['Juvenil D', 18, 'JUV D', 'At. Hospitalense', 0, 'Diumenge', '14:00'],
  ['Amateur B', 20, 'AMAT B', 'Carmelo', 1, 'Dissabte', '20:00'],
  ['Primer Equip', 20, '1r EQUIP', 'Vilafranca', 1, 'Dissabte', '18:00'],
];

const NOMS = ['Pau', 'Jan', 'Marc', 'Nil', 'Pol', 'Arnau', 'Biel', 'Martí', 'Àlex', 'Hugo', 'Leo', 'Joel', 'Eric', 'Oriol', 'Adrià', 'Gerard', 'Iker', 'Unai', 'Roc', 'Quim', 'Dani', 'Sergi', 'Aleix', 'Bruno', 'Mateo', 'Izan', 'Lucas', 'Aitor', 'Jordi', 'Xavi', 'Omar', 'Youssef', 'Ibrahim', 'Kevin', 'Santi', 'Guillem', 'Ferran', 'Enzo', 'Nico', 'Lluc', 'Ot', 'Bernat'];
const COG = ['Garcia', 'Martínez', 'López', 'Puig', 'Soler', 'Vidal', 'Ferrer', 'Roca', 'Serra', 'Font', 'Pujol', 'Casals', 'Riera', 'Vila', 'Mas', 'Sala', 'Costa', 'Navarro', 'Romero', 'Torres', 'Domènech', 'Bosch', 'Camps', 'Rovira', 'Pons', 'Castells', 'Ruiz', 'Sánchez', 'Moreno', 'Giménez', 'Batlle', 'Oliver', 'Prat', 'Sabaté', 'Valls', 'Llorens', 'Molina', 'Benítez', 'Fuster', 'Marín', 'El Idrissi', 'Mendoza'];
const SQUAD: Position[] = ['POR', 'POR', 'DEF', 'DEF', 'DEF', 'DEF', 'MIG', 'MIG', 'MIG', 'MIG', 'DAV', 'DAV', 'DAV'];
const GOAL_PROB: Record<Position, number> = { POR: 0, DEF: 0.12, MIG: 0.28, DAV: 0.45 };

export const SEED_MATCHDAYS = 5;

export function generateSeedData(seed = 20260927): { teams: SeedTeam[]; players: SeedPlayer[] } {
  const r = createRng(seed);
  const pick = <V>(a: readonly V[]): V => a[Math.floor(r() * a.length)] as V;

  const teams: SeedTeam[] = T.map(([name, age, short, rival, home, day, time]) => ({
    name,
    age,
    short,
    j5: { rival, isHome: home === 1, day: day === 'Dissabte' ? 'sat' : 'sun', kickoff: time },
    results: [0, 0, 0, 0, 0].map(() => ({ goalsFor: Math.floor(r() * 5), goalsAgainst: Math.floor(r() * 4) })),
  }));

  const stats = (pos: Position, rs: { goalsFor: number }): SeedStats => {
    if (r() < 0.12) return { minutes: 0, goals: 0, assists: 0, yellow: 0, red: 0, coach: 0 };
    const full = r() < 0.7;
    let g = 0;
    if (r() < GOAL_PROB[pos]) {
      g = 1;
      if (r() < 0.25) g = 2;
    }
    g = Math.min(g, rs.goalsFor);
    const a = r() < 0.2 && rs.goalsFor > g ? 1 : 0;
    const y = r() < 0.12 ? 1 : 0;
    const coach = Math.floor(r() * 4);
    return { minutes: full ? 2 : 1, goals: g, assists: a, yellow: y, red: 0, coach };
  };

  const players: SeedPlayer[] = [];
  const used = new Set<string>();
  teams.forEach((t, ti) =>
    SQUAD.forEach((position, k) => {
      let name: string;
      do name = pick(NOMS) + ' ' + pick(COG) + ' ' + pick(COG);
      while (used.has(name));
      used.add(name);
      const st = t.results.map((rs) => stats(position, rs));
      const drift = Math.round((r() * 2.8 - 0.9) * 10) / 10;
      const base = basePrice(t.age);
      players.push({ name, team: ti, position, number: k + 1, price: Math.max(base - 1, Math.round((base + drift) * 10) / 10), stats: st });
    }),
  );
  return { teams, players };
}

/** Rivals inventats per a J1–J4 (el prototip només té els de la J5). */
export function seedFixture(team: SeedTeam, teamIndex: number, matchday: number): SeedFixture {
  if (matchday === 5) return team.j5;
  const rivals = T.map((x) => x[3]);
  const back = 5 - matchday;
  return {
    rival: rivals[(teamIndex + matchday * 7) % rivals.length] as string,
    isHome: back % 2 === 0 ? team.j5.isHome : !team.j5.isHome,
    day: team.j5.day,
    kickoff: team.j5.kickoff,
  };
}

/** A la J5 (dilluns 28/9) ja hi ha publicats els partits de dissabte i els de diumenge abans de les 13:00. */
export function seedPublishedInJ5(team: SeedTeam): boolean {
  return team.j5.day === 'sat' || team.j5.kickoff < '13:00';
}
