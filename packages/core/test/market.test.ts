import { describe, expect, it } from 'vitest';
import { availableBalance, checkBid, checkClause, checkOffer, checkTrade, clausePrice, dailyListing, resolveBids, type Bid, type ManagerState } from '../src/index.js';
import { LIMITS, player } from './helpers.js';

describe('clàusula', () => {
  it('1,5 × preu, arrodonit a 0,1M', () => {
    expect(clausePrice(6)).toBe(9);
    expect(clausePrice(7.3)).toBe(11);
    expect(clausePrice(8.7)).toBe(13.1);
  });

  it('cal saldo i complir límits', () => {
    const target = player('DAV', 'A', 8);
    const buyer: ManagerState = { balance: 11.9, squad: [] };
    expect(checkClause(buyer, 11.9, target, LIMITS)).toEqual({ code: 'INSUFFICIENT_BALANCE', needed: 12 });
    expect(checkClause(buyer, 12, target, LIMITS)).toBeNull();
    const full: ManagerState = { balance: 50, squad: [player('POR', 'A'), player('DEF', 'A'), player('MIG', 'A')] };
    expect(checkClause(full, 50, target, LIMITS)?.code).toBe('TEAM_LIMIT');
  });
});

describe('pujes', () => {
  it('el saldo de les pujes actives queda reservat', () => expect(availableBalance(10, [3, 2.5])).toBe(4.5));

  it('com a mínim el preu i amb saldo disponible', () => {
    const p = player('MIG', 'A', 6.4);
    const m: ManagerState = { balance: 10, squad: [] };
    expect(checkBid(m, 10, p, 6.3, LIMITS)?.code).toBe('BID_BELOW_PRICE');
    expect(checkBid(m, 6, p, 6.4, LIMITS)?.code).toBe('INSUFFICIENT_BALANCE');
    expect(checkBid(m, 10, p, 6.4, LIMITS)).toBeNull();
  });

  const mk = (managers: Record<string, ManagerState>) => new Map(Object.entries(managers));

  it('guanya la més alta; empat, la més antiga', () => {
    const p = player('DAV', 'A', 6);
    const players = new Map([[p.id, p]]);
    const bids: Bid[] = [
      { id: 'b1', managerId: 'm1', playerId: p.id, amount: 7, createdAt: 2 },
      { id: 'b2', managerId: 'm2', playerId: p.id, amount: 8, createdAt: 3 },
      { id: 'b3', managerId: 'm3', playerId: p.id, amount: 8, createdAt: 1 },
    ];
    const r = resolveBids(bids, mk({ m1: { balance: 20, squad: [] }, m2: { balance: 20, squad: [] }, m3: { balance: 20, squad: [] } }), players, LIMITS);
    expect(r.find((x) => x.status === 'won')?.bidId).toBe('b3');
    expect(r.filter((x) => x.status === 'lost')).toHaveLength(2);
  });

  it('si el guanyador ja no compleix, passa a la següent puja', () => {
    const a = player('DAV', 'A', 6);
    const b = player('MIG', 'B', 6);
    const players = new Map([[a.id, a], [b.id, b]]);
    const bids: Bid[] = [
      { id: 'x1', managerId: 'm1', playerId: a.id, amount: 9, createdAt: 1 },
      { id: 'x2', managerId: 'm1', playerId: b.id, amount: 8, createdAt: 1 },
      { id: 'x3', managerId: 'm2', playerId: b.id, amount: 7, createdAt: 1 },
    ];
    // m1 té 12M: guanya A (9M) i ja no pot pagar B (8M) → B per a m2.
    const r = resolveBids(bids, mk({ m1: { balance: 12, squad: [] }, m2: { balance: 10, squad: [] } }), players, LIMITS);
    expect(r).toEqual([
      { bidId: 'x1', status: 'won' },
      { bidId: 'x2', status: 'lost', reason: 'INSUFFICIENT_BALANCE' },
      { bidId: 'x3', status: 'won' },
    ]);
  });

  it('respecta el límit per equip entre pujes del mateix mànager', () => {
    const ps = [player('DEF', 'A'), player('MIG', 'A')];
    const players = new Map(ps.map((p) => [p.id, p]));
    const squad = [player('POR', 'A'), player('DAV', 'A')];
    const bids: Bid[] = ps.map((p, i) => ({ id: 'y' + i, managerId: 'm1', playerId: p.id, amount: 7 - i, createdAt: 1 }));
    const r = resolveBids(bids, mk({ m1: { balance: 50, squad } }), players, LIMITS);
    expect(r.map((x) => x.status)).toEqual(['won', 'lost']);
  });
});

describe('intercanvis', () => {
  const give = player('DEF', 'A', 7);
  const get = player('MIG', 'B', 8);
  const from: ManagerState = { balance: 2, squad: [give, player('POR', 'B'), player('DAV', 'B')] };
  const to: ManagerState = { balance: 0, squad: [get] };

  it('vàlid amb diners a favor del rival', () => expect(checkTrade({ from, to, give, get, cash: 1.5 }, LIMITS, 2, 0)).toBeNull());
  it('qui paga ha de tenir saldo', () => {
    expect(checkTrade({ from, to, give, get, cash: 2.5 }, LIMITS, 2, 0)?.code).toBe('INSUFFICIENT_BALANCE');
    expect(checkTrade({ from, to, give, get, cash: -0.5 }, LIMITS, 2, 0)?.code).toBe('INSUFFICIENT_BALANCE');
  });
  it('límit per equip als dos costats', () => {
    const from2: ManagerState = { balance: 0, squad: [give, player('POR', 'B'), player('DAV', 'B'), player('MIG', 'B')] };
    expect(checkTrade({ from: from2, to, give, get, cash: 0 }, LIMITS, 0, 0)?.code).toBe('TEAM_LIMIT');
  });
  it('els jugadors han de ser de cadascú', () => expect(checkTrade({ from: to, to: from, give, get, cash: 0 }, LIMITS, 0, 0)?.code).toBe('NOT_OWNER'));
});

describe('ofertes', () => {
  it('import positiu, saldo i límits', () => {
    const p = player('DEF', 'A', 6);
    const m: ManagerState = { balance: 5, squad: [] };
    expect(checkOffer(m, 5, p, 0, LIMITS)?.code).toBe('INVALID');
    expect(checkOffer(m, 5, p, 6, LIMITS)?.code).toBe('INSUFFICIENT_BALANCE');
    expect(checkOffer(m, 5, p, 5, LIMITS)).toBeNull();
  });
});

describe('dailyListing', () => {
  const ids = Array.from({ length: 100 }, (_, i) => 'p' + i);
  it('16 jugadors, deterministes per llavor, sense repetits', () => {
    const a = dailyListing(ids, 42);
    expect(a).toHaveLength(16);
    expect(new Set(a).size).toBe(16);
    expect(dailyListing(ids.slice().reverse(), 42)).toEqual(a);
    expect(dailyListing(ids, 43)).not.toEqual(a);
  });
  it('si n’hi ha menys de 16, tots', () => expect(dailyListing(['a', 'b'], 1).sort()).toEqual(['a', 'b']));
});
