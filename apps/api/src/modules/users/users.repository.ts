import type { RegisterInput } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';

export class UsersRepository {
  findById(id: string) { return prisma.user.findUnique({ where: { id } }); }
  findByEmail(email: string) { return prisma.user.findUnique({ where: { email } }); }
  findByUsername(username: string) { return prisma.user.findUnique({ where: { username } }); }
  findByIdentifier(identifier: string) {
    return prisma.user.findFirst({
      where: { OR: [{ email: identifier.toLowerCase() }, { username: { equals: identifier, mode: 'insensitive' } }] },
    });
  }
  create(input: RegisterInput, passwordHash: string) {
    return prisma.user.create({
      data: {
        email: input.email,
        username: input.username,
        passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      },
    });
  }
  list() { return prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }
}
