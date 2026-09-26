import type { LoginInput, RegisterInput } from '@footy-finder/shared';
import argon2 from 'argon2';
import { AppError } from '../../errors/app-error.js';
import { toAuthenticatedUser } from '../users/user.mapper.js';
import { UsersRepository } from '../users/users.repository.js';
import { VerificationService } from './verification.service.js';

export class AuthService {
  constructor(
    private readonly users = new UsersRepository(),
    private readonly verification = new VerificationService(),
  ) {}

  async register(input: RegisterInput) {
    if (await this.users.findByEmail(input.email)) {
      throw new AppError(409, 'That email address is already registered.', 'EMAIL_TAKEN');
    }
    if (await this.users.findByUsername(input.username)) {
      throw new AppError(409, 'That username is already taken.', 'USERNAME_TAKEN');
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await this.users.create(input, passwordHash);
      await this.verification.sendEmailVerification(user.id).catch(() => undefined);
      return toAuthenticatedUser(user);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new AppError(409, 'An account with those details already exists.', 'ACCOUNT_TAKEN');
      }
      throw error;
    }
  }

  async login(input: LoginInput) {
    const user = await this.users.findByIdentifier(input.identifier);
    if (!user || !(await argon2.verify(user.passwordHash, input.password))) {
      throw new AppError(401, 'Email/username or password is incorrect.', 'INVALID_CREDENTIALS');
    }
    if (user.accountStatus !== 'ACTIVE')
      throw new AppError(
        403,
        'This account is currently restricted. Contact support if you need help.',
        'ACCOUNT_RESTRICTED',
      );
    return toAuthenticatedUser(user);
  }
}
