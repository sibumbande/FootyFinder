import { describe, expect, it, vi } from 'vitest';
import type { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';

const planningMatch = (member: boolean) => ({
  id: 'match-1',
  createdById: 'captain-1',
  mode: 'TEAM_MATCH' as const,
  status: 'DRAFT' as const,
  startsAt: new Date('2020-01-01T18:00:00.000Z'),
  durationMinutes: 50,
  participants: [],
  teamSides: [{ team: { memberships: member ? [{ id: 'membership-1' }] : [] } }],
});

describe('Team Match lobby authorization', () => {
  it('allows a current attached-Team member into a persistent DRAFT room', async () => {
    const repository = {
      findMatch: vi.fn().mockResolvedValue(planningMatch(true)),
      create: vi.fn().mockResolvedValue({
        id: 'message-1',
        matchId: 'match-1',
        senderId: 'member-1',
        content: 'Still planning',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        editedAt: null,
        deletedAt: null,
        sender: null,
      }),
    } as unknown as ChatRepository;
    await expect(
      new ChatService(repository).send('match-1', 'member-1', 'Still planning'),
    ).resolves.toMatchObject({ content: 'Still planning' });
    expect(repository.findMatch).toHaveBeenCalledWith('match-1', 'member-1');
  });

  it('rejects users who are not hosts, participants, or current attached-Team members', async () => {
    const repository = {
      findMatch: vi.fn().mockResolvedValue(planningMatch(false)),
      listForMatch: vi.fn(),
    } as unknown as ChatRepository;
    await expect(new ChatService(repository).history('match-1', 'outsider')).rejects.toMatchObject({
      code: 'LOBBY_ACCESS_REQUIRED',
    });
    expect(repository.listForMatch).not.toHaveBeenCalled();
  });
});
