import type { Position } from './constants.js';

export interface PlayerRef {
  id: string;
  teamId: string;
  position: Position;
  price: number;
}

export interface Limits {
  squadMax: number;
  maxPerTeam: number;
}
