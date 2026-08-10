import type { CreateMatchInput, MatchParticipant, SquadRole, TeamSide, UpdateMatchInput } from '@footy-finder/shared';
import { MATCH_CAPACITY, MATCH_FEE_CENTS, RESERVES_PER_TEAM, STARTERS_PER_TEAM } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { toMatch, toMatchParticipant } from './match.mapper.js';
import { AlreadyJoinedError, InsufficientBalanceError, MatchesRepository } from './matches.repository.js';

type Slot = { team: TeamSide; squadRole: SquadRole; slotNumber: number };

export function findNextSlot(participants: Pick<MatchParticipant, 'team' | 'squadRole' | 'slotNumber'>[]): Slot | null {
  for (const squadRole of ['STARTER', 'RESERVE'] as const) {
    const limit = squadRole === 'STARTER' ? STARTERS_PER_TEAM : RESERVES_PER_TEAM;
    const counts = {
      HOME: participants.filter((item) => item.team === 'HOME' && item.squadRole === squadRole).length,
      AWAY: participants.filter((item) => item.team === 'AWAY' && item.squadRole === squadRole).length,
    };
    const team: TeamSide = counts.HOME <= counts.AWAY ? 'HOME' : 'AWAY';
    if (counts[team] < limit) return { team, squadRole, slotNumber: counts[team] + 1 };
  }
  return null;
}

export class MatchesService {
  constructor(private readonly matches = new MatchesRepository()) {}

  async list() { return (await this.matches.list()).map(toMatch); }
  async get(id: string) { const match = await this.matches.findById(id); if (!match) throw new AppError(404, 'Match lobby not found.', 'MATCH_NOT_FOUND'); return toMatch(match); }
  async create(input: CreateMatchInput, userId: string) {
    try {
      return toMatch(await this.matches.createWithCharge(input, userId, MATCH_FEE_CENTS));
    } catch (error) {
      this.rethrowWalletError(error);
    }
  }

  async update(id: string, input: UpdateMatchInput, userId: string) {
    await this.assertHost(id, userId);
    return toMatch(await this.matches.update(id, input));
  }

  async remove(id: string, userId: string) { await this.assertHost(id, userId); await this.matches.remove(id); }

  async join(id: string, userId: string) {
    const match = await this.matches.findById(id);
    if (!match) throw new AppError(404, 'Match lobby not found.', 'MATCH_NOT_FOUND');
    if (!['OPEN', 'FULL'].includes(match.status)) throw new AppError(409, 'This lobby is not accepting players.', 'MATCH_CLOSED');
    const existing = await this.matches.findParticipant(id, userId);
    if (existing?.status === 'JOINED') throw new AppError(409, 'You have already joined this lobby.', 'ALREADY_JOINED');
    if (match.participants.length >= MATCH_CAPACITY) throw new AppError(409, 'This lobby is full.', 'MATCH_FULL');
    const slot = findNextSlot(match.participants);
    if (!slot) throw new AppError(409, 'This lobby is full.', 'MATCH_FULL');
    try {
      const participant = await this.matches.joinWithCharge(
        id,
        userId,
        slot.team,
        slot.squadRole,
        slot.slotNumber,
        MATCH_FEE_CENTS,
        match.participants.length + 1 >= MATCH_CAPACITY,
      );
      return toMatchParticipant(participant);
    } catch (error) {
      this.rethrowWalletError(error);
    }
  }

  async leave(id: string, userId: string) {
    const match = await this.matches.findById(id);
    if (!match) throw new AppError(404, 'Match lobby not found.', 'MATCH_NOT_FOUND');
    if (match.createdById === userId) throw new AppError(409, 'The host must delete the lobby instead of leaving it.', 'HOST_CANNOT_LEAVE');
    const participant = await this.matches.findParticipant(id, userId);
    if (!participant || participant.status !== 'JOINED') throw new AppError(409, 'You have not joined this lobby.', 'NOT_JOINED');
    await this.matches.leave(id, userId);
    if (match.status === 'FULL') await this.matches.setStatus(id, 'OPEN');
  }

  async participants(id: string) { return (await this.get(id)).participants ?? []; }

  private async assertHost(id: string, userId: string) {
    const match = await this.matches.findById(id);
    if (!match) throw new AppError(404, 'Match lobby not found.', 'MATCH_NOT_FOUND');
    if (match.createdById !== userId) throw new AppError(403, 'Only the lobby host can do that.', 'HOST_REQUIRED');
    return match;
  }

  private rethrowWalletError(error: unknown): never {
    if (error instanceof InsufficientBalanceError) {
      throw new AppError(402, 'You need at least R80.00 in your wallet for this match.', 'INSUFFICIENT_BALANCE');
    }
    if (error instanceof AlreadyJoinedError) {
      throw new AppError(409, 'You have already joined this lobby.', 'ALREADY_JOINED');
    }
    throw error;
  }
}
