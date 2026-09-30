import { describe, expect, it } from 'vitest';
import { sendTeamChatMessageSchema, teamChatQuerySchema } from './team-chat.js';

describe('team chat schemas (Gate 7 / TKT-710)', () => {
  it('trims messages and bounds their length', () => {
    expect(sendTeamChatMessageSchema.parse({ content: '  See you at 7  ' })).toEqual({ content: 'See you at 7' });
    expect(sendTeamChatMessageSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(sendTeamChatMessageSchema.safeParse({ content: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('defaults and bounds the page size', () => {
    expect(teamChatQuerySchema.parse({})).toEqual({ limit: 30 });
    expect(teamChatQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});
