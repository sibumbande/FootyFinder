import { describe, expect, it } from 'vitest';
import { createMatchInviteToken, hashMatchInviteToken } from './invite-token.js';

describe('Quick Match invitation tokens', () => {
  it('creates high-entropy tokens and persists only a deterministic SHA-256 digest', () => {
    const first = createMatchInviteToken();
    const second = createMatchInviteToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashMatchInviteToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashMatchInviteToken(first)).toBe(hashMatchInviteToken(first));
    expect(hashMatchInviteToken(first)).not.toContain(first);
  });
});
