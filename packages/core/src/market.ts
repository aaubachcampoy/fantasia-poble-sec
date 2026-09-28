import { CLAUSE_MULTIPLIER, DAILY_LISTING_SIZE } from './constants.js';
import type { RuleError } from './errors.js';
import { round1 } from './money.js';
import { createRng, shuffle } from './rng.js';
import { canAdd } from './squad.js';
import type { Limits, PlayerRef } from './types.js';

export interface ManagerState {
  balance: number;
  squad: PlayerRef[];
}

export function clausePrice(price: number): number {
  return round1(price * CLAUSE_MULTIPLIER);
}

/** Saldo disponible: els diners de les pujes actives queden reservats. */
export function availableBalance(balance: number, activeBidAmounts: readonly number[]): number {
  return round1(balance - activeBidAmounts.reduce((a, b) => a + b, 0));
}

/** Vendre al mercat: immediat, cobres el preu actual. */
export function saleProceeds(p: PlayerRef): number {
  return round1(p.price);
}

export function checkClause(buyer: ManagerState, available: number, target: PlayerRef, limits: Limits): RuleError | null {
  const err = canAdd(buyer.squad, target, limits);
  if (err) return err;
  const c = clausePrice(target.price);
  if (available < c) return { code: 'INSUFFICIENT_BALANCE', needed: c };
  return null;
}

/**
 * Validar una puja nova o modificada. `available` ha d'excloure la puja anterior pel mateix jugador.
 * El límit de plantilla i d'equip es torna a comprovar a la resolució.
 */
export function checkBid(bidder: ManagerState, available: number, target: PlayerRef, amount: number, limits: Limits): RuleError | null {
  if (round1(amount) < round1(target.price)) return { code: 'BID_BELOW_PRICE', min: target.price };
  const err = canAdd(bidder.squad, target, limits);
  if (err) return err;
  if (available < amount) return { code: 'INSUFFICIENT_BALANCE', needed: amount };
  return null;
}

export interface Bid {
  id: string;
  managerId: string;
  playerId: string;
  amount: number;
  /** Ordenable (ISO o epoch). */
  createdAt: string | number;
}

export type BidOutcome = { bidId: string; status: 'won' } | { bidId: string; status: 'lost'; reason: 'OUTBID' | RuleError['code'] };

/**
 * Resolució al tancament del mercat. Es processen totes les pujes de més alta a més baixa
 * (empat: la més antiga). Guanya la primera vàlida per a cada jugador; si el guanyador ja no
 * té saldo o incompleix els límits, passa a la següent.
 */
export function resolveBids(bids: readonly Bid[], managers: ReadonlyMap<string, ManagerState>, players: ReadonlyMap<string, PlayerRef>, limits: Limits): BidOutcome[] {
  const state = new Map([...managers].map(([id, m]) => [id, { balance: m.balance, squad: m.squad.slice() }]));
  const awarded = new Set<string>();
  const sorted = bids.slice().sort((a, b) => b.amount - a.amount || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const out: BidOutcome[] = [];
  for (const bid of sorted) {
    const m = state.get(bid.managerId);
    const p = players.get(bid.playerId);
    if (awarded.has(bid.playerId)) {
      out.push({ bidId: bid.id, status: 'lost', reason: 'OUTBID' });
      continue;
    }
    if (!m || !p) {
      out.push({ bidId: bid.id, status: 'lost', reason: 'INVALID' });
      continue;
    }
    const err = canAdd(m.squad, p, limits) ?? (m.balance < bid.amount ? ({ code: 'INSUFFICIENT_BALANCE', needed: bid.amount } as const) : null);
    if (err) {
      out.push({ bidId: bid.id, status: 'lost', reason: err.code });
      continue;
    }
    m.balance = round1(m.balance - bid.amount);
    m.squad.push(p);
    awarded.add(bid.playerId);
    out.push({ bidId: bid.id, status: 'won' });
  }
  return out;
}

export interface TradeProposal {
  /** Qui proposa. */
  from: ManagerState;
  to: ManagerState;
  /** Jugador de `from` que surt. */
  give: PlayerRef;
  /** Jugador de `to` que entra. */
  get: PlayerRef;
  /** Diners: positiu = `from` paga a `to`; negatiu = `to` paga a `from`. */
  cash: number;
}

/** Intercanvi 1×1: tots dos han de complir els límits i qui paga ha de tenir saldo. */
export function checkTrade(t: TradeProposal, limits: Limits, fromAvailable: number, toAvailable: number): RuleError | null {
  if (!t.from.squad.some((p) => p.id === t.give.id)) return { code: 'NOT_OWNER' };
  if (!t.to.squad.some((p) => p.id === t.get.id)) return { code: 'INVALID', detail: 'El jugador ja no és del rival.' };
  const e1 = canAdd(t.from.squad, t.get, limits, [t.give.id]);
  if (e1) return e1;
  const e2 = canAdd(t.to.squad, t.give, limits, [t.get.id]);
  if (e2) return e2;
  if (t.cash > 0 && fromAvailable < t.cash) return { code: 'INSUFFICIENT_BALANCE', needed: t.cash };
  if (t.cash < 0 && toAvailable < -t.cash) return { code: 'INSUFFICIENT_BALANCE', needed: -t.cash };
  return null;
}

/** Oferta de compra a un altre mànager. */
export function checkOffer(buyer: ManagerState, available: number, target: PlayerRef, amount: number, limits: Limits): RuleError | null {
  if (!(amount > 0)) return { code: 'INVALID', detail: "L'oferta ha de ser més gran que 0." };
  const err = canAdd(buyer.squad, target, limits);
  if (err) return err;
  if (available < amount) return { code: 'INSUFFICIENT_BALANCE', needed: amount };
  return null;
}

/** Els 16 lliures del dia, deterministes per llavor (p. ej. hash de lliga + data). */
export function dailyListing(freeIds: readonly string[], seed: number, size = DAILY_LISTING_SIZE): string[] {
  return shuffle(createRng(seed), freeIds.slice().sort()).slice(0, size);
}
