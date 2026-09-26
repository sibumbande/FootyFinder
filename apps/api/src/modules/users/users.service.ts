import { AppError } from '../../errors/app-error.js';
import { toAuthenticatedUser, toPublicUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';

export class UsersService {
  constructor(private readonly users = new UsersRepository()) {}
  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'Authentication required.', 'UNAUTHENTICATED');
    return toAuthenticatedUser(user);
  }
  async list() {
    return (await this.users.list()).map(toPublicUser);
  }
  async get(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(404, 'Player profile not found.', 'PLAYER_NOT_FOUND');
    const rows = await this.users.statistics(userId);
    const statistics = rows.reduce(
      (summary, participation) => {
        const result = participation.match.result!;
        summary.matchesPlayed += 1;
        if (result.outcomeType === 'FORFEIT') {
          if (result.forfeitWinner === participation.team) summary.wins += 1;
          else summary.losses += 1;
        } else if (result.homeScore === result.awayScore) summary.draws += 1;
        else if ((participation.team === 'HOME' && result.homeScore > result.awayScore) || (participation.team === 'AWAY' && result.awayScore > result.homeScore)) summary.wins += 1;
        else summary.losses += 1;
        if (result.outcomeType === 'PLAYED')
          summary.goals += participation.scoring.reduce((total, scorer) => total + scorer.goals, 0);
        return summary;
      },
      { matchesPlayed: 0, wins: 0, draws: 0, losses: 0, goals: 0 },
    );
    return { ...toPublicUser(user), statistics };
  }
  async updateProfile(
    userId: string,
    input: import('@footy-finder/shared').UpdatePlayerProfileInput,
  ) {
    return toAuthenticatedUser(await this.users.updateProfile(userId, input));
  }
}
