import { describe, expect, it } from 'vitest';
import type { TeamSide } from '@footy-finder/shared';
import { canRunTeamMatchCommand, TEAM_MATCH_COMMANDS, TEAM_MATCH_COMMAND_SIDE } from './team-side-authority.js';

/**
 * TKT-708 exhaustive matrix: every command x every combination of managed sides x every target
 * side. Owners and captains are "managers"; members, outsiders, demoted or removed captains and
 * platform admins manage no side (managedTeamSides returns []), so they can run nothing.
 */
const managerSets: TeamSide[][] = [[], ['HOME'], ['AWAY'], ['HOME', 'AWAY']];
const targets: Array<TeamSide | undefined> = [undefined, 'HOME', 'AWAY'];

describe('side-scoped team-match authority (Gate 7 / TKT-708)', () => {
  for (const command of TEAM_MATCH_COMMANDS)
    for (const managed of managerSets)
      for (const target of targets) {
        const owner = TEAM_MATCH_COMMAND_SIDE[command];
        const expected = owner === 'OWN' ? Boolean(target && managed.includes(target)) : managed.includes(owner);
        it(`${command} by manager of [${managed.join(',') || 'nothing'}] on ${target ?? 'match'} -> ${expected ? 'allowed' : 'refused'}`, () => {
          expect(canRunTeamMatchCommand(command, managed, target)).toBe(expected);
        });
      }

  it('keeps the approved owners: home owns the match, the away team only withdraws itself, each side manages itself', () => {
    expect(canRunTeamMatchCommand('CANCEL_MATCH', ['AWAY'])).toBe(false);
    expect(canRunTeamMatchCommand('WITHDRAW_TEAM', ['HOME'])).toBe(false);
    expect(canRunTeamMatchCommand('FILL_METER', ['HOME'], 'AWAY')).toBe(false);
    expect(canRunTeamMatchCommand('FILL_METER', ['AWAY'], 'AWAY')).toBe(true);
    expect(canRunTeamMatchCommand('UPDATE_MATCH', [])).toBe(false);
  });
});
