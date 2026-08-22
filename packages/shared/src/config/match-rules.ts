import type { MatchRule } from '../types/match.js';

export interface MatchRuleConfig {
  label: string;
  description: string;
}

export const MATCH_RULE_CONFIG: Record<MatchRule, MatchRuleConfig> = {
  GOALKEEPERS_SWAP_AFTER_EVERY_GOAL: {
    label: 'Goalkeepers swap after every goal',
    description: 'An informational house rule for players; it does not automate lineup changes.',
  },
};
