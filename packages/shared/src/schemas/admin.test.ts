import { describe, expect, it } from 'vitest';
import { managedVenueInputSchema } from './admin.js';

const venue = {
  name: 'Test Venue',
  addressLine1: '1 Main Road',
  city: 'Cape Town',
  region: 'Western Cape',
  countryCode: 'ZA',
};

describe('managedVenueInputSchema', () => {
  it('accepts an IANA venue timezone and supplies the launch default', () => {
    expect(managedVenueInputSchema.parse(venue).timezone).toBe('Africa/Johannesburg');
    expect(managedVenueInputSchema.parse({ ...venue, timezone: 'America/New_York' }).timezone).toBe(
      'America/New_York',
    );
  });

  it('rejects a timezone that cannot support local slot calculation', () => {
    expect(() => managedVenueInputSchema.parse({ ...venue, timezone: 'Cape Town time' })).toThrow();
  });
});
