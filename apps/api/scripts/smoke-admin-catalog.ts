import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { appendAdminAudit } from '../src/modules/admin/admin-audit.js';

const marker = `slice-3-catalog-${randomUUID()}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
let rolledBack = false;
let overlapBlocked = false;

try {
  await prisma.$transaction(async (tx) => {
    const actor = await tx.user.create({ data: { email: `${marker}@smoke.invalid`, username: marker.slice(0, 28), passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
    const venue = await tx.managedVenue.create({ data: { name: marker, addressLine1: '1 Smoke Street', city: 'Johannesburg', region: 'Gauteng', countryCode: 'ZA' } });
    const field = await tx.managedField.create({ data: { venueId: venue.id, name: 'Pitch A', supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }, { format: 'SEVEN_A_SIDE' }] } } });
    await tx.managedFieldAvailability.createMany({ data: [
      { fieldId: field.id, dayOfWeek: 1, startMinute: 480, endMinute: 720 },
      { fieldId: field.id, dayOfWeek: 1, startMinute: 720, endMinute: 1320 },
    ] });
    await tx.managedFieldException.create({ data: { fieldId: field.id, startsAt: new Date('2026-12-25T00:00:00Z'), endsAt: new Date('2026-12-26T00:00:00Z'), reason: 'Holiday closure' } });
    await tx.managedFieldPrice.create({ data: { fieldId: field.id, amountCents: 80000, effectiveFrom: new Date('2026-09-01T00:00:00Z'), effectiveTo: new Date('2027-01-01T00:00:00Z') } });
    const aggregate = await tx.managedVenue.findUniqueOrThrow({ where: { id: venue.id }, include: { fields: { include: { supportedFormats: true, availabilityPeriods: true, exceptions: true, prices: true } } } });
    assert(aggregate.fields[0]?.supportedFormats.length === 2, 'Supported formats were not persisted.');
    assert(aggregate.fields[0]?.availabilityPeriods.length === 2, 'Operating hours were not persisted.');
    assert(aggregate.fields[0]?.exceptions.length === 1, 'Field exception was not persisted.');
    assert(aggregate.fields[0]?.prices[0]?.amountCents === 80000, 'Effective price was not persisted.');
    await appendAdminAudit(tx, { actorUserId: actor.id, action: 'SMOKE_CATALOG_CREATED', entityType: 'MANAGED_VENUE', entityId: venue.id, requestId: marker });
    throw new Error('ROLLBACK_CATALOG_SMOKE');
  });
} catch (error) {
  rolledBack = String(error).includes('ROLLBACK_CATALOG_SMOKE');
} finally {
  assert(rolledBack, 'Catalogue smoke transaction did not reach its rollback sentinel.');
  assert((await prisma.managedVenue.count({ where: { name: marker } })) === 0, 'Managed venue remained after rollback.');
  assert((await prisma.user.count({ where: { email: `${marker}@smoke.invalid` } })) === 0, 'Admin smoke user remained after rollback.');
  assert((await prisma.adminAuditLog.count({ where: { requestId: marker } })) === 0, 'Admin audit remained after rollback.');
}

try {
  await prisma.$transaction(async (tx) => {
    const venue = await tx.managedVenue.create({ data: { name: `${marker}-overlap`, addressLine1: '2 Smoke Street', city: 'Johannesburg', region: 'Gauteng', countryCode: 'ZA' } });
    const field = await tx.managedField.create({ data: { venueId: venue.id, name: 'Pitch B', supportedFormats: { create: [{ format: 'FIVE_A_SIDE' }] } } });
    await tx.managedFieldPrice.create({ data: { fieldId: field.id, amountCents: 50000, effectiveFrom: new Date('2027-01-01T00:00:00Z'), effectiveTo: new Date('2027-06-01T00:00:00Z') } });
    await tx.managedFieldPrice.create({ data: { fieldId: field.id, amountCents: 60000, effectiveFrom: new Date('2027-05-01T00:00:00Z'), effectiveTo: new Date('2027-07-01T00:00:00Z') } });
  });
} catch (error) {
  overlapBlocked = String(error).includes('ManagedFieldPrice_no_overlap');
} finally {
  assert(overlapBlocked, 'Database allowed overlapping effective field prices.');
  assert((await prisma.managedVenue.count({ where: { name: `${marker}-overlap` } })) === 0, 'Overlap fixture did not roll back exactly.');
  await prisma.$disconnect();
}

console.log('Slice 3 managed venue, field, schedule, exception, pricing, audit, and cleanup smoke test passed.');
