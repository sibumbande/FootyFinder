import argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import type { UsersRepository } from '../users/users.repository.js';
import { AuthService } from './auth.service.js';

const now = new Date('2026-01-01T00:00:00.000Z');
const user = { id: '4a5529e6-4289-4f0a-94b7-233950def34d', email: 'player@example.com', username: 'player1', passwordHash: '', firstName: 'Pat', lastName: 'Player', avatarUrl: null, balanceCents: 0, createdAt: now, updatedAt: now };
const input = { email: user.email, username: user.username, password: 'football9', firstName: 'Pat', lastName: 'Player' };

function repository(overrides: Record<string, unknown> = {}) {
  return { findByEmail: vi.fn().mockResolvedValue(null), findByUsername: vi.fn().mockResolvedValue(null), findByIdentifier: vi.fn().mockResolvedValue(null), findById: vi.fn(), list: vi.fn(), create: vi.fn().mockImplementation((_input, passwordHash) => Promise.resolve({ ...user, passwordHash })), ...overrides } as unknown as UsersRepository;
}

describe('AuthService', () => {
  it('creates a user with an Argon2 hash instead of the raw password', async () => {
    const users = repository();
    const result = await new AuthService(users).register(input);
    const hash = vi.mocked(users.create).mock.calls[0][1];
    expect(hash).not.toBe(input.password);
    expect(await argon2.verify(hash, input.password)).toBe(true);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email', async () => {
    const service = new AuthService(repository({ findByEmail: vi.fn().mockResolvedValue(user) }));
    await expect(service.register(input)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_TAKEN' });
  });

  it('rejects a duplicate username', async () => {
    const service = new AuthService(repository({ findByUsername: vi.fn().mockResolvedValue(user) }));
    await expect(service.register(input)).rejects.toMatchObject({ statusCode: 409, code: 'USERNAME_TAKEN' });
  });

  it('logs in with valid credentials and rejects invalid credentials', async () => {
    const passwordHash = await argon2.hash(input.password);
    const valid = new AuthService(repository({ findByIdentifier: vi.fn().mockResolvedValue({ ...user, passwordHash }) }));
    await expect(valid.login({ identifier: user.username, password: input.password })).resolves.toMatchObject({ id: user.id });
    await expect(valid.login({ identifier: user.email, password: 'incorrect' })).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });
});
