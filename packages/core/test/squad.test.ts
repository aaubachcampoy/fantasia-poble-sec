import { describe, expect, it } from 'vitest';
import { canAdd, ruleMessage, squadValue, validateSquad } from '../src/index.js';
import { LIMITS, player } from './helpers.js';

describe('canAdd', () => {
  it('màxim 18 jugadors', () => {
    const squad = Array.from({ length: 18 }, (_, i) => player('MIG', 't' + i));
    const e = canAdd(squad, player('DAV', 'x'), LIMITS);
    expect(e).toEqual({ code: 'SQUAD_FULL', max: 18 });
    expect(ruleMessage(e!)).toBe('Plantilla plena (18). Ven un jugador abans.');
  });

  it('17 jugadors: en cap un més', () => {
    const squad = Array.from({ length: 17 }, (_, i) => player('MIG', 't' + i));
    expect(canAdd(squad, player('DAV', 'x'), LIMITS)).toBeNull();
  });

  it('màxim 3 del mateix equip real', () => {
    const squad = [player('POR', 'S12A'), player('DEF', 'S12A'), player('MIG', 'S12A')];
    const e = canAdd(squad, player('DAV', 'S12A'), LIMITS);
    expect(e).toEqual({ code: 'TEAM_LIMIT', teamId: 'S12A', max: 3 });
    expect(ruleMessage(e!, () => 'Aleví S12 A')).toBe('Ja tens 3 jugadors del Aleví S12 A.');
  });

  it('el límit per equip és configurable', () => {
    const squad = [player('POR', 'A'), player('DEF', 'A')];
    expect(canAdd(squad, player('MIG', 'A'), { ...LIMITS, maxPerTeam: 2 })?.code).toBe('TEAM_LIMIT');
  });

  it('en un intercanvi, el que surt allibera lloc', () => {
    const out = player('DEF', 'A');
    const squad = [player('POR', 'A'), player('MIG', 'A'), out];
    expect(canAdd(squad, player('DEF', 'A'), LIMITS, [out.id])).toBeNull();
  });

  it('no es pot afegir un jugador que ja hi és', () => {
    const p = player('DEF');
    expect(canAdd([p], p, LIMITS)?.code).toBe('INVALID');
  });
});

describe('validateSquad', () => {
  it('detecta repetits i excés per equip', () => {
    const p = player('DEF', 'A');
    expect(validateSquad([p, p], LIMITS)?.code).toBe('INVALID');
    expect(validateSquad([player('DEF', 'A'), player('DEF', 'A'), player('DEF', 'A'), player('DEF', 'A')], LIMITS)?.code).toBe('TEAM_LIMIT');
  });
});

it('squadValue', () => expect(squadValue([player('DEF', 'a', 6.2), player('MIG', 'b', 8.1)])).toBeCloseTo(14.3));
