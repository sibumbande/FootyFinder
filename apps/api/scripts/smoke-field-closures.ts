import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { fieldClosureInputSchema } from '@footy-finder/shared';
import { prisma } from '../src/database/prisma.js';
import { FieldClosuresService } from '../src/modules/admin/field-closures.service.js';
import { BookingsService } from '../src/modules/bookings/bookings.service.js';
import { VenuesService } from '../src/modules/venues/venues.service.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

/**
 * CEO touch-up batch 3, item 3 on PostgreSQL: weekly and one-off field closures hide slots and block booking,
 * the venue stays live (D1), a clashing match is listed (never cancelled), and removing a closure reopens it.
 */
const marker = `smoke-closures-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const TZ = 'Africa/Johannesburg';
const localDate = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const weekday = (date: Date) => ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(date) as 'Sun'];
const venue = managedVenueFixture(marker);
const closures = new FieldClosuresService();
const bookings = new BookingsService();
const matchIds: string[] = [];
const userIds: string[] = [];

try {
  const fieldId = await venue.create();
  const admin = await prisma.user.create({ data: { email: `${marker}-admin@smoke.invalid`, username: `cl_${randomUUID().slice(0, 10)}_a`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } });
  const host = await prisma.user.create({ data: { email: `${marker}-host@smoke.invalid`, username: `cl_${randomUUID().slice(0, 10)}_h`, passwordHash: 'smoke-test-only' } });
  userIds.push(host.id);
  const kickoff = venue.nextKickoff(); // 12:00 Johannesburg, 3+ days ahead
  const match = await bookings.createQuickMatch({ managedFieldId: fieldId, name: `${marker} booked`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: kickoff.toISOString() }, host.id);
  matchIds.push(match.id);
  const nextWeek = new Date(kickoff.getTime() + 7 * 86_400_000);
  const slug = `${marker}-venue`;
  const times = async (date: Date) => (await new VenuesService().slots(slug, { fieldId, format: 'FIVE_A_SIDE', dateFrom: localDate(date), dateTo: localDate(date) })).map(({ localTime }) => localTime);
  assert((await times(nextWeek)).includes('12:00'), 'The fixture field should be open at 12:00 before any closure.');

  // A weekly closure (e.g. club training) from today, 11:30-13:00 on the match's weekday.
  const weekly = await closures.add(fieldId, fieldClosureInputSchema.parse({ kind: 'WEEKLY', dayOfWeek: weekday(kickoff), startMinute: 690, endMinute: 780, startsOn: localDate(new Date()), reason: 'Club training' }), admin.id, marker);
  assert(weekly.venue.publicationStatus === 'PUBLISHED', 'Adding a closure took the venue offline (D1).');
  assert(weekly.clashes.length === 1 && weekly.clashes[0]!.matchId === match.id, 'The booked match inside the closure was not listed as a clash.');
  assert((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).status !== 'CANCELLED', 'A clashing match was cancelled automatically.');
  const closed = await times(nextWeek);
  assert(!['11:00', '11:30', '12:00', '12:30'].some((time) => closed.includes(time)) && closed.includes('10:30') && closed.includes('13:00'), `Closed slots were offered or open slots hidden: ${closed.join(' ')}`);
  let refused = '';
  await bookings.createQuickMatch({ managedFieldId: fieldId, name: `${marker} refused`, format: 'FIVE_A_SIDE', substituteCapacityPerTeam: 2, rollingSubstitutes: false, rules: [], visibility: 'PUBLIC', startsAt: nextWeek.toISOString() }, host.id)
    .catch((error: { code?: string }) => { refused = error.code ?? String(error); });
  assert(refused === 'FIELD_CLOSED', `Booking a closed time was not refused (got ${refused || 'a booking'}).`);

  // A one-off closure on another day hides that day's slots in its range only.
  const otherDay = new Date(kickoff.getTime() + 86_400_000);
  const oneOff = await closures.add(fieldId, fieldClosureInputSchema.parse({ kind: 'ONE_OFF', startsAt: new Date(otherDay.getTime() - 60 * 60_000).toISOString(), endsAt: new Date(otherDay.getTime() + 60 * 60_000).toISOString(), reason: 'Pitch resurfacing' }), admin.id, marker);
  const otherTimes = await times(otherDay);
  assert(!otherTimes.includes('11:30') && !otherTimes.includes('12:00') && otherTimes.includes('13:00'), `The one-off closure did not hide its slots: ${otherTimes.join(' ')}`);
  assert(!JSON.stringify(await new VenuesService().get(slug)).includes('Club training'), 'A closure reason reached the public venue page.');

  // Removing the weekly closure reopens its slots; the audit trail keeps both actions.
  const weeklyId = weekly.venue.fields[0]!.closures.find(({ kind }) => kind === 'WEEKLY')!.id;
  await closures.remove(fieldId, weeklyId, 'Training moved', admin.id, marker);
  assert((await times(nextWeek)).includes('12:00'), 'Removing the closure did not reopen the slot.');
  assert(oneOff.venue.fields[0]!.closures.length === 2, 'The admin view does not list both closures.');
  const audit = await prisma.adminAuditLog.count({ where: { requestId: marker, action: { in: ['FIELD_CLOSURE_CREATED', 'FIELD_CLOSURE_REMOVED'] } } });
  assert(audit === 3, `Expected 3 audited closure actions, found ${audit}.`);
  console.log('Field closures smoke passed: weekly and one-off closures hide slots and refuse bookings, the venue stays live, a clashing match is listed but not cancelled, reasons stay admin-only, and removing a closure reopens its slots.');
} finally {
  await venue.cleanupMatches(matchIds);
  await prisma.formationSlot.deleteMany({ where: { matchId: { in: matchIds } } }).catch(() => undefined);
  await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
  await prisma.managedFieldClosure.deleteMany({ where: { reason: { in: ['Club training', 'Pitch resurfacing'] }, field: { venue: { slug: `${marker}-venue` } } } });
  await venue.cleanupVenue().catch((error) => console.error('venue cleanup failed', error));
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  // The admin stays in the disposable test database: audit entries are append-only.
  await prisma.$disconnect();
}
