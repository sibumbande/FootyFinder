import { publicMatchSlugSchema } from '@footy-finder/shared';
import { describe, expect, it } from 'vitest';
import { createPublicMatchSlug, publicMatchUrl } from './public-match.js';

describe('public Match identifiers', () => {
  it('creates opaque, valid identifiers with collision-resistant randomness', () => {
    const slugs = new Set(Array.from({ length: 500 }, createPublicMatchSlug));
    expect(slugs.size).toBe(500);
    for (const slug of slugs) expect(publicMatchSlugSchema.safeParse(slug).success).toBe(true);
  });

  it('builds the canonical route without referral or campaign parameters', () => {
    const slug = 'm-0123456789abcdef01234567';
    expect(publicMatchUrl(slug)).toBe(`http://localhost:5173/m/${slug}`);
    expect(publicMatchUrl(slug)).not.toContain('?');
  });
});
