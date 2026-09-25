import { describe, expect, it } from 'vitest';
import { createTeamSchema, updateTeamSchema } from './team.js';

const validTeam = {
  name: 'Footy Finder FC',
  primaryFormat: 'FIVE_A_SIDE' as const,
  formationKey: 'BALANCED_1_1_2_1',
};

describe('Team short-name contract', () => {
  it('normalizes valid create and update values to uppercase', () => {
    expect(createTeamSchema.parse({ ...validTeam, shortName: 'ff24' }).shortName).toBe('FF24');
    expect(updateTeamSchema.parse({ shortName: 'abc' }).shortName).toBe('ABC');
  });

  it.each(['ABCDE', 'A-B', 'A B', '!'])(
    'rejects invalid short name %s',
    (shortName) => {
      expect(() => createTeamSchema.parse({ ...validTeam, shortName })).toThrow();
    },
  );

  it('keeps the optional short name absent', () => {
    expect(createTeamSchema.parse(validTeam).shortName).toBeUndefined();
  });
});
