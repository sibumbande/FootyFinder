import { describe, expect, it } from 'vitest';
import { loginSchema, registerFormSchema, registerSchema } from './auth.js';
describe('authentication schemas', () => {
  it('normalizes email and trims account fields', () => {
    const result = registerSchema.parse({
      email: ' Player@Example.COM ',
      username: ' player_1 ',
      password: 'football9',
      firstName: ' Pat ',
    });
    expect(result.email).toBe('player@example.com');
    expect(result.username).toBe('player_1');
    expect(result.firstName).toBe('Pat');
  });
  it('requires matching password confirmation', () => {
    const result = registerFormSchema.safeParse({
      email: 'player@example.com',
      username: 'player1',
      password: 'football9',
      confirmPassword: 'football8',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.flatten().fieldErrors.confirmPassword).toContain(
        'Passwords do not match',
      );
  });
  it('rejects whitespace-only names while allowing omitted names', () => {
    expect(
      registerSchema.safeParse({
        email: 'player@example.com',
        username: 'player1',
        password: 'football9',
        firstName: '   ',
      }).success,
    ).toBe(false);
    expect(
      registerSchema.safeParse({
        email: 'player@example.com',
        username: 'player1',
        password: 'football9',
      }).success,
    ).toBe(true);
  });
  it('accepts email or username login identifiers', () => {
    expect(loginSchema.safeParse({ identifier: 'player1', password: 'secret' }).success).toBe(true);
  });
});
