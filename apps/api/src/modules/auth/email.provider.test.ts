import { describe, expect, it } from 'vitest';
import { isReservedEmailAddress } from './email.provider.js';

describe('reserved email addresses', () => {
  it('never treats mock, smoke or example addresses as deliverable', () => {
    for (const address of ['player01@footyfinder.test', 'x-referee@smoke.invalid', 'a@b.example', 'a@host.localhost', 'someone@example.com', ' PLAYER02@FootyFinder.TEST '])
      expect(isReservedEmailAddress(address)).toBe(true);
  });

  it('leaves real addresses alone', () => {
    for (const address of ['someone@gmail.com', 'ops@footyfinder.co.za', 'test@testing.com', 'a@example.co.za'])
      expect(isReservedEmailAddress(address)).toBe(false);
  });
});
