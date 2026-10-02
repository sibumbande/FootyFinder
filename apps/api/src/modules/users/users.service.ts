import { AppError } from '../../errors/app-error.js';
import { toAuthenticatedUser, toPublicUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';
import { isHiddenAccount } from './hidden-account.js';
import { aggregatePlayerStatistics } from './player-statistics.js';

export class UsersService {
  constructor(private readonly users = new UsersRepository()) {}
  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'Authentication required.', 'UNAUTHENTICATED');
    return toAuthenticatedUser(user);
  }
  async list() {
    return (await this.users.list()).filter(({ accountStatus }) => !isHiddenAccount(accountStatus)).map(toPublicUser);
  }
  async get(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(404, 'Player profile not found.', 'PLAYER_NOT_FOUND');
    // CEO batch 5 (D10): the profile of a deleting or deleted player shows nothing about them.
    if (isHiddenAccount(user.accountStatus))
      throw new AppError(404, 'This player has left FootyFinder.', 'PLAYER_LEFT');
    const statistics = aggregatePlayerStatistics(await this.users.statistics(userId));
    return { ...toPublicUser(user), statistics };
  }
  async updateProfile(
    userId: string,
    input: import('@footy-finder/shared').UpdatePlayerProfileInput,
  ) {
    return toAuthenticatedUser(await this.users.updateProfile(userId, input));
  }
}
