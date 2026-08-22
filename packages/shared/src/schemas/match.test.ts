import { describe, expect, it } from 'vitest';
import { createMatchSchema, createTeamMatchSchema } from './match.js';

const validMatch = {
  name: 'Friday football',
  format: 'FIVE_A_SIDE' as const,
  visibility: 'PUBLIC' as const,
  startsAt: '2099-08-23T18:00:00.000Z',
  feeCents: 8_000,
  venue: {
    name: 'Central Arena',
    addressLine1: '1 Main Road',
    city: 'Johannesburg',
    region: 'Gauteng',
    countryCode: 'ZA',
  },
};

describe('createMatchSchema', () => {
  it('defaults existing clients to five substitutes and standard substitutions', () => {
    expect(createMatchSchema.parse(validMatch)).toMatchObject({
      substituteCapacityPerTeam: 5,
      rollingSubstitutes: false,
      rules: [],
    });
  });

  it.each([0, 5, 10])('accepts %i substitutes per team', (substituteCapacityPerTeam) => {
    expect(createMatchSchema.parse({ ...validMatch, substituteCapacityPerTeam })).toMatchObject({
      substituteCapacityPerTeam,
    });
  });

  it.each([-1, 11, 1.5])('rejects invalid substitute capacity %s', (capacity) => {
    expect(() =>
      createMatchSchema.parse({ ...validMatch, substituteCapacityPerTeam: capacity }),
    ).toThrow();
  });

  it('accepts typed informational rules and rolling substitutions', () => {
    expect(
      createMatchSchema.parse({
        ...validMatch,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      }),
    ).toMatchObject({
      rollingSubstitutes: true,
      rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
    });
  });

  it('rejects duplicate informational rules', () => {
    expect(() =>
      createMatchSchema.parse({
        ...validMatch,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL', 'GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      }),
    ).toThrow();
  });
});

describe('createTeamMatchSchema', () => {
  it('accepts Team fixture planning data without visibility or fees', () => {
    const parsed = createTeamMatchSchema.parse({
      ...validMatch,
      visibility: undefined,
      feeCents: undefined,
      formationKey: 'BALANCED_1_1_2_1',
    });
    expect(parsed).toMatchObject({
      formationKey: 'BALANCED_1_1_2_1',
      substituteCapacityPerTeam: 5,
    });
    expect(parsed).not.toHaveProperty('visibility');
    expect(parsed).not.toHaveProperty('feeCents');
  });
});
