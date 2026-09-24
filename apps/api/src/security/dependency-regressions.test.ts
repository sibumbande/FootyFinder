import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Qs = {
  parse(
    value: string,
    options?: { arrayLimit?: number; comma?: boolean; throwOnLimitExceeded?: boolean },
  ): unknown;
  stringify(value: unknown): string;
};

const require = createRequire(import.meta.url);
const qs = require('qs') as Qs;

describe('query parser security regressions', () => {
  it('does not invoke a non-callable constructor.isBuffer property while stringifying', () => {
    const hostile = { a: { constructor: { isBuffer: 'not-callable' } } };

    expect(() => qs.stringify(hostile)).not.toThrow();
    expect(qs.stringify(hostile)).toBe('a%5Bconstructor%5D%5BisBuffer%5D=not-callable');
  });

  it('enforces arrayLimit for comma groups under empty bracket notation', () => {
    expect(() =>
      qs.parse('a[]=1,2,3,4', {
        comma: true,
        arrayLimit: 3,
        throwOnLimitExceeded: true,
      }),
    ).toThrow(RangeError);
  });

  it('bounds cumulative comma groups instead of allowing duplicate keys to exceed arrayLimit', () => {
    expect(() =>
      qs.parse('a=1,2,3&a=4,5,6', {
        comma: true,
        arrayLimit: 5,
        throwOnLimitExceeded: true,
      }),
    ).toThrow(RangeError);
  });
});
