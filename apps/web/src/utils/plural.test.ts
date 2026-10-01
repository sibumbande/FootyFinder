import { describe, expect, it } from 'vitest';
import { plural } from './plural.js';

describe('plural (CEO batch 3, item 10)', () => {
  it('uses the singular only for exactly one', () => {
    expect(plural(1, 'member')).toBe('1 member');
    expect(plural(0, 'member')).toBe('0 members');
    expect(plural(2, 'review')).toBe('2 reviews');
    expect(plural(1, 'place left', 'places left')).toBe('1 place left');
    expect(plural(5, 'place left', 'places left')).toBe('5 places left');
  });
});
