import type { AdminWaitingList, AdminWaitingListQuery } from '@footy-finder/shared';
import { adminWaitingListQuerySchema } from '@footy-finder/shared';
import { prisma } from '../../database/prisma.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { saDate, sourceLabel, toWaitingListCsv } from './waiting-list-csv.js';

const PAGE_SIZE = 50;
/**
 * CEO touch-up batch 3.5, item 4 (D8). Removed (anonymised) entries never appear; the CSV holds only people
 * still subscribed, and each download is audited with the city and row count (never the emails).
 */
export class WaitingListAdminService {
  async list(query: AdminWaitingListQuery): Promise<AdminWaitingList> {
    const { cityId, subscribed, page } = adminWaitingListQuerySchema.parse(query);
    const where: Prisma.CityInterestWhereInput = {
      deletedAt: null,
      ...(cityId && { cityId }),
      ...(subscribed === 'yes' && { unsubscribedAt: null }),
      ...(subscribed === 'no' && { unsubscribedAt: { not: null } }),
    };
    const [cities, counts, total, rows] = await Promise.all([
      prisma.city.findMany({ orderBy: [{ supportStatus: 'desc' }, { name: 'asc' }] }),
      prisma.cityInterest.groupBy({ by: ['cityId', 'unsubscribedAt'], where: { deletedAt: null }, _count: { _all: true } }),
      prisma.cityInterest.count({ where }),
      prisma.cityInterest.findMany({ where, include: { city: true }, orderBy: { consentedAt: 'desc' }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    const tally = (id: string, active: boolean) =>
      counts.filter((row) => row.cityId === id && (row.unsubscribedAt === null) === active).reduce((sum, row) => sum + row._count._all, 0);
    const perCity = cities
      .map((city) => ({ cityId: city.id, name: city.name, supportStatus: city.supportStatus, subscribed: tally(city.id, true), unsubscribed: tally(city.id, false) }))
      .filter((city) => city.supportStatus === 'WAITLIST' || city.subscribed + city.unsubscribed > 0);
    return {
      totalSubscribed: perCity.reduce((sum, city) => sum + city.subscribed, 0),
      cities: perCity,
      entries: rows.map((row) => ({
        id: row.id,
        email: row.email,
        cityName: row.city.name,
        signedUpAt: row.consentedAt.toISOString(),
        subscribed: row.unsubscribedAt === null,
        source: sourceLabel(row.source),
      })),
      total,
      page,
      pageSize: PAGE_SIZE,
    };
  }

  async csv(cityId: string | undefined, actorUserId: string, requestId?: string) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.cityInterest.findMany({
        where: { deletedAt: null, unsubscribedAt: null, ...(cityId && { cityId }) },
        include: { city: true },
        orderBy: [{ city: { name: 'asc' } }, { consentedAt: 'asc' }],
      });
      const city = cityId ? await tx.city.findUnique({ where: { id: cityId } }) : null;
      await appendAdminAudit(tx, {
        actorUserId,
        action: 'WAITING_LIST_EXPORTED',
        entityType: 'CITY_INTEREST',
        ...(cityId && { entityId: cityId }),
        requestId,
        metadata: { city: city?.name ?? 'All cities', rowCount: rows.length },
      });
      const slug = (city?.code ?? 'all-cities').toLowerCase().replaceAll('_', '-');
      return {
        filename: `waiting-list-${slug}-${saDate(new Date())}.csv`,
        body: toWaitingListCsv(rows.map((row) => ({ email: row.email, cityName: row.city.name, signedUpAt: row.consentedAt, source: row.source }))),
      };
    });
  }
}
