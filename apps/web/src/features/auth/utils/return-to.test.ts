import { describe, expect, it } from 'vitest';
import { loginPathFor, safeReturnTo } from './return-to.js';

describe('safeReturnTo', () => {
  it('preserves an internal path, query, and fragment', () => {
    expect(safeReturnTo('/matches/fixture-1?team=HOME#formation')).toBe(
      '/matches/fixture-1?team=HOME#formation',
    );
  });

  it.each([
    null,
    '',
    'https://attacker.invalid/steal',
    '//attacker.invalid/steal',
    '/\\attacker.invalid/steal',
    '/%5cattacker.invalid/steal',
    '/%255cattacker.invalid/steal',
    '/%25255cattacker.invalid/steal',
    '/%2f%2fattacker.invalid/steal',
    '/%0d%0aLocation:%20https://attacker.invalid',
    '/bad%',
  ])('rejects an unsafe return destination: %s', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });

  it('constructs a login URL from the complete current location', () => {
    expect(
      loginPathFor({ pathname: '/matches/1', search: '?team=AWAY', hash: '#lineup' }),
    ).toBe('/login?returnTo=%2Fmatches%2F1%3Fteam%3DAWAY%23lineup');
  });
});
