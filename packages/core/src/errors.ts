import { formatMoney } from './money.js';

export type RuleError =
  | { code: 'SQUAD_FULL'; max: number }
  | { code: 'TEAM_LIMIT'; teamId: string; max: number }
  | { code: 'INSUFFICIENT_BALANCE'; needed: number }
  | { code: 'MARKET_CLOSED' }
  | { code: 'LINEUP_LOCKED' }
  | { code: 'BID_BELOW_PRICE'; min: number }
  | { code: 'NOT_OWNER' }
  | { code: 'ALREADY_OWNED' }
  | { code: 'NOT_LISTED' }
  | { code: 'INVALID'; detail: string };

/** Missatges en català, tal com surten als prototips. */
export function ruleMessage(e: RuleError, teamName: (id: string) => string = (id) => id): string {
  switch (e.code) {
    case 'SQUAD_FULL':
      return `Plantilla plena (${e.max}). Ven un jugador abans.`;
    case 'TEAM_LIMIT':
      return `Ja tens ${e.max} jugadors del ${teamName(e.teamId)}.`;
    case 'INSUFFICIENT_BALANCE':
      return `Saldo insuficient (${formatMoney(e.needed)}).`;
    case 'MARKET_CLOSED':
      return 'El mercat és tancat fins dilluns.';
    case 'LINEUP_LOCKED':
      return 'Alineació bloquejada durant la jornada.';
    case 'BID_BELOW_PRICE':
      return `La puja ha de ser com a mínim de ${formatMoney(e.min)}.`;
    case 'NOT_OWNER':
      return 'Aquest jugador no és teu.';
    case 'ALREADY_OWNED':
      return 'Aquest jugador ja té propietari.';
    case 'NOT_LISTED':
      return 'Aquest jugador no és al mercat avui.';
    case 'INVALID':
      return e.detail;
  }
}
