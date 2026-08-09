import { AppError } from '../../errors/app-error.js';
import { toPublicUser } from './user.mapper.js';
import { UsersRepository } from './users.repository.js';

export class UsersService {
  constructor(private readonly users = new UsersRepository()) {}
  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new AppError(401, 'Authentication required.', 'UNAUTHENTICATED');
    return toPublicUser(user);
  }
  async list() { return (await this.users.list()).map(toPublicUser); }
}
