import { describe, expect, it } from 'vitest';
import {
  assignTeamMatchStarterSchema,
  createMatchSchema,
  createTeamMatchSchema,
  openTeamMatchLineupSlotSchema,
  removeTeamMatchStarterSchema,
  teamMatchAvailabilityQuerySchema,
  updateMyTeamMatchAvailabilitySchema,
  updateTeamMatchLineupSlotPositionSchema,
} from './match.js';

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

describe('Team Match availability schemas', () => {
  it.each(['AVAILABLE', 'MAYBE', 'UNAVAILABLE', 'NO_RESPONSE'] as const)(
    'accepts the %s response status',
    (status) => {
      expect(updateMyTeamMatchAvailabilitySchema.parse({ status })).toEqual({ status });
    },
  );

  it('parses selected query values strictly', () => {
    expect(teamMatchAvailabilityQuerySchema.parse({ selected: 'true' }).selected).toBe(true);
    expect(teamMatchAvailabilityQuerySchema.parse({ selected: 'false' }).selected).toBe(false);
    expect(() => teamMatchAvailabilityQuerySchema.parse({ selected: '1' })).toThrow();
  });

  it('validates availability filters', () => {
    expect(teamMatchAvailabilityQuerySchema.parse({ availability: 'NO_RESPONSE' })).toMatchObject({
      availability: 'NO_RESPONSE',
    });
    expect(() => teamMatchAvailabilityQuerySchema.parse({ availability: 'UNKNOWN' })).toThrow();
  });
});

describe('Team Match lineup schemas', () => {
  it('validates supported displacement actions', () => {
    expect(
      assignTeamMatchStarterSchema.parse({
        userId: 'cfd39df4-1275-40ca-85da-b13b115a6205',
        displacedPlayerAction: 'BENCH',
      }),
    ).toMatchObject({ displacedPlayerAction: 'BENCH' });
    expect(() =>
      assignTeamMatchStarterSchema.parse({
        userId: 'cfd39df4-1275-40ca-85da-b13b115a6205',
        displacedPlayerAction: 'REPLACE',
      }),
    ).toThrow();
  });

  it('limits removal and opening actions to bench or remove', () => {
    expect(removeTeamMatchStarterSchema.parse({ playerAction: 'REMOVE' })).toEqual({
      playerAction: 'REMOVE',
    });
    expect(openTeamMatchLineupSlotSchema.parse({})).toEqual({});
    expect(() => removeTeamMatchStarterSchema.parse({ playerAction: 'SWAP' })).toThrow();
  });

  it('requires bounded coordinates for Match-Day movement', () => {
    expect(updateTeamMatchLineupSlotPositionSchema.parse({ positionX: 45, positionY: 70 })).toEqual(
      { positionX: 45, positionY: 70 },
    );
    expect(() =>
      updateTeamMatchLineupSlotPositionSchema.parse({ positionX: 45, positionY: 101 }),
    ).toThrow();
  });
});
