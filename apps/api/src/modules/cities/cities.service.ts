import { createHash, randomBytes } from 'node:crypto';
import type { CityInterestInput } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const cityDto = (city: { id: string; code: string; name: string; countryCode: string; timezone: string; supportStatus: 'ACTIVE' | 'WAITLIST' }) => city;

export class CitiesService {
  async list() {
    return (await prisma.city.findMany({ orderBy: [{ supportStatus: 'asc' }, { name: 'asc' }] })).map(cityDto);
  }

  async listInterestsForAdmin() {
    const rows = await prisma.cityInterest.findMany({
      include: { city: true },
      orderBy: { consentedAt: 'desc' },
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      city: cityDto(row.city),
      email: row.email,
      userId: row.userId,
      source: row.source,
      consentedAt: row.consentedAt.toISOString(),
      unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
    }));
  }

  async joinInterest(input: CityInterestInput, authenticatedUserId?: string) {
    const city = await prisma.city.findUnique({ where: { id: input.cityId } });
    if (!city) throw new AppError(400, 'Choose a listed city.', 'CITY_INVALID');
    if (city.supportStatus === 'ACTIVE')
      throw new AppError(409, 'Footy Finder is already available in this city.', 'CITY_ALREADY_SUPPORTED');
    let email = input.email;
    if (authenticatedUserId) {
      const user = await prisma.user.findUnique({ where: { id: authenticatedUserId }, select: { email: true } });
      if (!user) throw new AppError(401, 'Authentication required.', 'UNAUTHENTICATED');
      email = user.email;
    }
    const dedupeKey = digest(`${city.id}:${email.toLowerCase()}`);
    const managementToken = randomBytes(32).toString('base64url');
    const interest = await prisma.cityInterest.upsert({
      where: { dedupeKey },
      create: {
        cityId: city.id,
        userId: authenticatedUserId,
        email: email.toLowerCase(),
        dedupeKey,
        manageTokenHash: digest(managementToken),
        consentedAt: new Date(),
        source: input.source,
      },
      update: {
        userId: authenticatedUserId,
        manageTokenHash: digest(managementToken),
        consentedAt: new Date(),
        source: input.source,
        unsubscribedAt: null,
        deletedAt: null,
      },
    });
    return { id: interest.id, city: cityDto(city), status: 'SUBSCRIBED' as const, managementToken };
  }

  async status(token: string) {
    const interest = await this.findByToken(token);
    return {
      id: interest.id,
      city: cityDto(interest.city),
      status: interest.deletedAt ? 'DELETED' as const : interest.unsubscribedAt ? 'UNSUBSCRIBED' as const : 'SUBSCRIBED' as const,
      consentedAt: interest.consentedAt.toISOString(),
    };
  }

  async unsubscribe(token: string) {
    const interest = await this.findByToken(token);
    await prisma.cityInterest.update({ where: { id: interest.id }, data: { unsubscribedAt: new Date() } });
    return { success: true };
  }

  async remove(token: string) {
    const interest = await this.findByToken(token);
    await prisma.cityInterest.update({
      where: { id: interest.id },
      data: { deletedAt: new Date(), unsubscribedAt: new Date(), email: `deleted-${interest.id}@deleted.invalid`, userId: null },
    });
    return { success: true };
  }

  private async findByToken(token: string) {
    const interest = await prisma.cityInterest.findUnique({
      where: { manageTokenHash: digest(token) },
      include: { city: true },
    });
    if (!interest) throw new AppError(404, 'Waiting-list entry not found.', 'CITY_INTEREST_NOT_FOUND');
    return interest;
  }
}
