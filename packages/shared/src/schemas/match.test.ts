import { describe, expect, it } from 'vitest';
import {
  assignTeamMatchStarterSchema,
  createMatchSchema,
  createTeamMatchSchema,
  discoveryQuerySchema,
  openTeamMatchLineupSlotSchema,
  publicMatchSlugSchema,
  removeTeamMatchStarterSchema,
  teamMatchAvailabilityQuerySchema,
  updateMyTeamMatchAvailabilitySchema,
  updateTeamMatchLineupSlotPositionSchema,
} from './match.js';

describe('publicMatchSlugSchema', () => {
  it('accepts only the canonical opaque identifier shape', () => {
    expect(publicMatchSlugSchema.parse('m-0123456789abcdef01234567')).toBe(
      'm-0123456789abcdef01234567',
    );
    for (const value of [
      '0123456789abcdef01234567',
      'm-0123456789ABCDEF01234567',
      'm-../../private',
      'm-0123456789abcdef012345678',
    ])
      expect(publicMatchSlugSchema.safeParse(value).success).toBe(false);
  });
});

const validMatch = {
  name: 'Friday football',
  format: 'FIVE_A_SIDE' as const,
  visibility: 'PUBLIC' as const,
  startsAt: '2099-08-23T18:00:00.000Z',
  managedFieldId: 'f03d12a0-9855-4a03-8948-739bad35e733',
};

const manualVenue = {
    name: 'Central Arena',
    addressLine1: '1 Main Road',
    city: 'Johannesburg',
    region: 'Gauteng',
    countryCode: 'ZA',
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

  it.each([0, 2_000, 8_000, 50_000])(
    'never lets a host choose the fee: a client-sent feeCents of %i is stripped (DEC-018)',
    (feeCents) => {
      expect(createMatchSchema.parse({ ...validMatch, feeCents })).not.toHaveProperty('feeCents');
    },
  );
});

describe('createTeamMatchSchema', () => {
  it('accepts Team fixture planning data without visibility or fees', () => {
    const parsed = createTeamMatchSchema.parse({
      ...validMatch,
      managedFieldId: undefined,
      venue: manualVenue,
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

describe('discoveryQuerySchema', () => {
  it('parses availableOnly using exact true and false query strings', () => {
    expect(discoveryQuerySchema.parse({ availableOnly: 'true' }).availableOnly).toBe(true);
    expect(discoveryQuerySchema.parse({ availableOnly: 'false' }).availableOnly).toBe(false);
    expect(discoveryQuerySchema.parse({}).availableOnly).toBe(false);
  });

  it.each(['1', '0', 'yes', 'FALSE', true, false])('rejects coercive boolean value %s', (value) => {
    expect(() => discoveryQuerySchema.parse({ availableOnly: value })).toThrow();
  });

  it('defaults and bounds the home-page result limit', () => {
    expect(discoveryQuerySchema.parse({}).limit).toBe(200);
    expect(discoveryQuerySchema.parse({ limit: '6' }).limit).toBe(6);
    expect(() => discoveryQuerySchema.parse({ limit: '201' })).toThrow();
  });

  it.each(['maxPriceCents', 'lat', 'lng', 'radiusKm', 'sort'])(
    'rejects removed discovery query parameter %s',
    (key) => {
      expect(() => discoveryQuerySchema.parse({ [key]: '1' })).toThrow();
    },
  );
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

describe('createMatchSchema: play as my team (Gate 7 / DEC-019)', () => {
  const teamId = '2f5d1c1e-51b8-4b8e-9f3c-6c7c8d0a1b2c';
  it('accepts a public team match with a side mode and subs', () => {
    expect(
      createMatchSchema.parse({ ...validMatch, playAsTeamId: teamId, otherSideMode: 'OPEN', teamSubstituteCount: 3 }),
    ).toMatchObject({ playAsTeamId: teamId, otherSideMode: 'OPEN', teamSubstituteCount: 3 });
  });

  it('requires "who can take the other side" and a subs count, and refuses private team matches', () => {
    expect(createMatchSchema.safeParse({ ...validMatch, playAsTeamId: teamId, teamSubstituteCount: 3 }).success).toBe(false);
    expect(createMatchSchema.safeParse({ ...validMatch, playAsTeamId: teamId, otherSideMode: 'TEAMS_ONLY' }).success).toBe(false);
    expect(
      createMatchSchema.safeParse({ ...validMatch, visibility: 'PRIVATE', playAsTeamId: teamId, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 0 }).success,
    ).toBe(false);
    expect(
      createMatchSchema.safeParse({ ...validMatch, playAsTeamId: teamId, otherSideMode: 'TEAMS_ONLY', teamSubstituteCount: 11 }).success,
    ).toBe(false);
  });

  it('leaves Quick Match creation unchanged', () => {
    expect(createMatchSchema.parse(validMatch)).not.toHaveProperty('playAsTeamId');
  });
});
