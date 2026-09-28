import { SocketEvents, type FormationSlot, type Match } from '@footy-finder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload?: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const fakeSocket = {
  emit: vi.fn(),
  on: (event: string, handler: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
  },
  off: (event: string, handler: Handler) => handlers.get(event)?.delete(handler),
};
const deliver = (event: string, payload?: unknown) =>
  handlers.get(event)?.forEach((handler) => handler(payload));

vi.mock('@/socket/socket.js', () => ({ ensureSocketConnected: () => fakeSocket }));

const { useMatchSocket } = await import('./useMatchSocket.js');

const slot = (participantId: string | null): FormationSlot => ({
  id: 'slot-1',
  matchId: 'match-1',
  team: 'HOME',
  slotIndex: 1,
  positionX: 50,
  positionY: 80,
  participantId,
});
const snapshot = (formationVersion: number, participantId: string | null, matchId = 'match-1') => ({
  matchId,
  formationVersion,
  slots: [slot(participantId)],
});

let cache: QueryClient;
const cachedMatch = () => cache.getQueryData<Match>(['matches', 'match-1']);
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={cache}>{children}</QueryClientProvider>
);

beforeEach(() => {
  handlers.clear();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(['matches', 'match-1'], {
    id: 'match-1',
    formationVersion: 2,
    formationSlots: [slot(null)],
  } as unknown as Match);
});
afterEach(cleanup);

describe('useMatchSocket formation convergence', () => {
  it('applies a newer committed snapshot without refetching unrelated match lists', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });
    const invalidate = vi.spyOn(cache, 'invalidateQueries');

    deliver(SocketEvents.matchFormationUpdated, snapshot(3, 'p1'));

    expect(cachedMatch()).toMatchObject({ formationVersion: 3, formationSlots: [{ participantId: 'p1' }] });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores duplicate and out-of-order echoes so a stale event cannot overwrite the board', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });

    deliver(SocketEvents.matchFormationUpdated, snapshot(5, 'newest'));
    deliver(SocketEvents.matchFormationUpdated, snapshot(5, 'duplicate'));
    deliver(SocketEvents.matchFormationUpdated, snapshot(4, 'late'));

    expect(cachedMatch()).toMatchObject({ formationVersion: 5, formationSlots: [{ participantId: 'newest' }] });
  });

  it('accepts a snapshot after missed versions, because every snapshot is complete', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });

    deliver(SocketEvents.matchFormationUpdated, snapshot(9, 'after-gap'));

    expect(cachedMatch()).toMatchObject({ formationVersion: 9 });
  });

  it('ignores snapshots for another match and malformed payloads', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });

    deliver(SocketEvents.matchFormationUpdated, snapshot(7, 'other', 'match-2'));
    deliver(SocketEvents.matchFormationUpdated, [slot('legacy-array')]);

    expect(cachedMatch()).toMatchObject({ formationVersion: 2, formationSlots: [{ participantId: null }] });
  });

  it('no longer refetches the whole lobby on the legacy unversioned formation event', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });
    const invalidate = vi.spyOn(cache, 'invalidateQueries');

    deliver(SocketEvents.formationUpdated, [slot('legacy')]);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('recovers events missed while disconnected by rejoining the room and refetching on reconnect', () => {
    renderHook(() => useMatchSocket('match-1'), { wrapper });
    const invalidate = vi.spyOn(cache, 'invalidateQueries');
    fakeSocket.emit.mockClear();

    deliver('connect');

    expect(fakeSocket.emit).toHaveBeenCalledWith(SocketEvents.joinRoom, { matchId: 'match-1' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['matches', 'match-1'] });
  });
});
