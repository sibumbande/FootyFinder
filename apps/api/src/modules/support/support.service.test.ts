import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { assertSupportTicketOpen, supportTicketDto } from './support.service.js';

const user = (id: string, displayName: string) => ({
  id, email: `${id}@example.test`, username: id, createdAt: new Date('2026-08-24T00:00:00Z'),
  profile: { displayName, avatarUrl: null, bio: null, dominantFoot: null, homeArea: null, createdAt: new Date('2026-08-24T00:00:00Z'), updatedAt: new Date('2026-08-24T00:00:00Z'), preferredPositions: [] },
});
const ticket = {
  id: 'ticket', referenceCode: 'FF-2026-TEST', subject: 'Help needed', category: 'GENERAL', status: 'OPEN', priority: 'NORMAL',
  lastMessageAt: new Date('2026-08-24T01:00:00Z'), resolvedAt: null, closedAt: null, createdAt: new Date('2026-08-24T00:00:00Z'), updatedAt: new Date('2026-08-24T01:00:00Z'),
  createdBy: user('player', 'Player'), assignedAdmin: user('admin', 'Admin'), messages: [
    { id: 'public', content: 'Visible response', authorRole: 'ADMIN', internal: false, createdAt: new Date('2026-08-24T00:30:00Z'), author: user('admin', 'Admin') },
    { id: 'private', content: 'Private investigation note', authorRole: 'ADMIN', internal: true, createdAt: new Date('2026-08-24T00:45:00Z'), author: user('admin', 'Admin') },
  ],
};

describe('Support privacy and state rules', () => {
  it('never exposes Admin-only notes through the player DTO', () => {
    const playerView = supportTicketDto(ticket, false);
    expect(playerView.messages).toHaveLength(1);
    expect(JSON.stringify(playerView)).not.toContain('Private investigation note');
    expect(supportTicketDto(ticket, true).messages).toHaveLength(2);
  });

  it('rejects replies to closed tickets with a stable error', () => {
    expect(() => assertSupportTicketOpen('OPEN')).not.toThrow();
    try { assertSupportTicketOpen('CLOSED'); } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SUPPORT_TICKET_CLOSED');
    }
  });
});
