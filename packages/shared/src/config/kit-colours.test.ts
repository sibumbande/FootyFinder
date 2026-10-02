import { describe, expect, it } from 'vitest';
import { createTeamSchema } from '../schemas/team.js';
import { KIT_COLOURS, contrastRatio, isKitColour, kitColoursTooSimilar, nearestKitColour, readableTextOn } from './kit-colours.js';

describe('kit colours (batch 5 brief, B1; CEO D17)', () => {
  it('has 18 named swatches with unique names and colours', () => {
    expect(KIT_COLOURS).toHaveLength(18);
    expect(new Set(KIT_COLOURS.map(({ name }) => name)).size).toBe(18);
    expect(new Set(KIT_COLOURS.map(({ hex }) => hex)).size).toBe(18);
  });

  it('maps any colour to the nearest swatch (existing teams and the mock world)', () => {
    expect(nearestKitColour('#1D4ED8').name).toBe('Royal blue');
    expect(nearestKitColour('#FACC15').name).toBe('Yellow');
    expect(nearestKitColour('#B91C1C').name).toBe('Red');
    expect(nearestKitColour('#ffffff').name).toBe('White');
    expect(nearestKitColour('#278A4B').name).toBe('Green');
    expect(nearestKitColour('#114422').name).toBe('Dark green');
    expect(nearestKitColour('#123522').name).toBe('Black'); // the old default secondary is nearly black
    expect(nearestKitColour('#123456').name).toBe('Navy');
    expect(nearestKitColour('not a colour').name).toBe('Green');
  });

  it('warns when the two colours are the same or too close, and picks readable text', () => {
    expect(kitColoursTooSimilar('#14213D', '#111111')).toBe(true); // Navy and Black
    expect(kitColoursTooSimilar('#D7262E', '#d7262e')).toBe(true);
    expect(kitColoursTooSimilar('#1E8E3E', '#FFFFFF')).toBe(false);
    expect(contrastRatio('#FFFFFF', '#111111')).toBeGreaterThan(18);
    expect(readableTextOn('#FFD400')).toBe('#111111');
    expect(readableTextOn('#14213D')).toBe('#FFFFFF');
  });

  it('teams can only save colours from the list', () => {
    expect(isKitColour('#1e8e3e')).toBe(true);
    const base = { name: 'Wanderers', primaryFormat: 'FIVE_A_SIDE', formationKey: 'x' } as const;
    expect(createTeamSchema.safeParse({ ...base, primaryColor: '#1e8e3e' }).data?.primaryColor).toBe('#1E8E3E');
    expect(createTeamSchema.safeParse({ ...base, primaryColor: '#123456' }).success).toBe(false);
  });
});
