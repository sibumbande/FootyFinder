import { describe, expect, it } from 'vitest';

// CEO touch-up batch 3.5, item 1: internal catalogue wording (approval process, VAT, field-slot prices)
// must never come back anywhere in the web app's source.
const sources = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BANNED = [/independently approved/i, /catalogue records/i, /VAT-inclusive/i, /per 60-minute field slot/i];

describe('web app wording', () => {
  it('scans the whole source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it.each(BANNED.map((pattern) => [pattern.source, pattern] as const))('never says "%s"', (_label, pattern) => {
    const offenders = Object.entries(sources).filter(([, text]) => pattern.test(text)).map(([file]) => file);
    expect(offenders).toEqual([]);
  });
});
