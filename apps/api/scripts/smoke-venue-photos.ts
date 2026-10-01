import './assert-disposable-test-database.js';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { prisma } from '../src/database/prisma.js';
import { VenueContentService } from '../src/modules/admin/venue-content.service.js';
import { VenuesService } from '../src/modules/venues/venues.service.js';
import { LocalFileStorage } from '../src/storage/file-storage.js';
import { VenuePhotoStorage } from '../src/modules/venues/venue-photo.storage.js';
import { managedVenueFixture } from './managed-venue-fixture.js';

/**
 * CEO touch-up batch 3, item 1: venue photos are uploaded, processed (1600 px WebP + 400 px thumbnail, no
 * metadata), and on a live venue saved as a pending change that only a second admin can approve (D1); the
 * venue stays live meanwhile. Rejection discards the change and its staged files.
 */
const marker = `smoke-venue-photos-${randomUUID().slice(0, 8)}`;
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};
const folder = await mkdtemp(join(tmpdir(), 'footy-venue-photos-'));
const service = new VenueContentService(new VenuePhotoStorage(new LocalFileStorage(folder, 'http://localhost:3000/uploads/venues')));
const venue = managedVenueFixture(marker);
const adminIds: string[] = [];
const photo = (colour: string) =>
  sharp({ create: { width: 2400, height: 1600, channels: 3, background: colour } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'GPS -33.9 18.4' } })
    .toBuffer();
const upload = async (adminId: string, colour: string) => {
  const buffer = await photo(colour);
  return service.uploadPhoto(venueId(), { buffer, mimetype: 'image/jpeg', size: buffer.length }, adminId, marker);
};
let venueRowId = '';
const venueId = () => venueRowId;

try {
  await venue.create();
  venueRowId = (await prisma.managedVenue.findUniqueOrThrow({ where: { slug: `${marker}-venue` } })).id;
  for (const name of ['alice', 'bongi'])
    adminIds.push((await prisma.user.create({ data: { email: `${marker}-${name}@smoke.invalid`, username: `vp_${randomUUID().slice(0, 10)}_${name}`, passwordHash: 'smoke-test-only', platformRole: 'ADMIN' } })).id);
  const [alice, bongi] = adminIds as [string, string];

  // Upload: processed to a 1600 px WebP and a 400 px thumbnail, metadata stripped.
  const first = await upload(alice, '#2a7');
  const stored = await readFile(join(folder, first.url.split('/').at(-1)!));
  const meta = await sharp(stored).metadata();
  assert(meta.format === 'webp' && meta.width === 1600 && meta.height === 1067, `The photo was not resized to 1600 px WebP (${meta.format} ${meta.width}x${meta.height}).`);
  assert(meta.exif === undefined, 'Camera metadata (and location) survived processing.');
  const thumb = await sharp(await readFile(join(folder, first.thumbUrl.split('/').at(-1)!))).metadata();
  assert(thumb.width === 400, 'The thumbnail is not 400 px wide.');
  let refused = false;
  await service.uploadPhoto(venueId(), { buffer: Buffer.from('not an image'), mimetype: 'image/jpeg', size: 12 }, alice).catch((error: { code?: string }) => { refused = error.code === 'VENUE_PHOTO_INVALID'; });
  assert(refused, 'A file that is not an image was accepted.');

  // On a live venue, saving photos creates a pending change; the venue stays live and unchanged.
  const second = await upload(alice, '#a72');
  const third = await upload(alice, '#27a');
  const saved = await service.saveContent(venueId(), {
    photos: [first, second, third].map((item, index) => ({ fileId: item.fileId, altText: `Pitch view ${index + 1}`, attribution: 'Photo: smoke venue' })),
    coverIndex: 1,
  }, alice, marker);
  assert(saved.publicationStatus === 'PUBLISHED' && saved.media.length === 0, 'Saving photos took the live venue offline or applied them without approval.');
  assert(saved.pendingContentChange?.payload.photos.length === 3, 'The pending change was not recorded.');
  const publicBefore = await new VenuesService().get(`${marker}-venue`);
  assert(publicBefore.venue.gallery.length === 0, 'Players saw unapproved photos.');

  // Dual control: the submitter cannot approve; a second admin can.
  let blocked = false;
  await service.approveChange(saved.pendingContentChange!.id, alice).catch((error: { code?: string }) => { blocked = error.code === 'VENUE_DUAL_CONTROL_REQUIRED'; });
  assert(blocked, 'The submitting admin approved their own photo change.');
  const approved = await service.approveChange(saved.pendingContentChange!.id, bongi, marker);
  assert(approved.publicationStatus === 'PUBLISHED' && approved.media.length === 3 && !approved.pendingContentChange, 'Approval did not apply the photos.');
  assert(approved.coverImageUrl === second.url, 'The chosen cover was not applied.');
  const publicAfter = await new VenuesService().get(`${marker}-venue`);
  assert(publicAfter.venue.gallery.length === 3 && publicAfter.venue.gallery[0]?.thumbUrl === first.thumbUrl, 'Players do not see the approved photos with thumbnails.');
  assert(publicAfter.venue.coverImage.url === second.url, 'Players do not see the chosen cover.');

  // A rejected change (reordered, one photo replaced) leaves the live gallery and deletes the staged upload.
  const fourth = await upload(bongi, '#777');
  const media = approved.media;
  const pending = await service.saveContent(venueId(), {
    photos: [
      { mediaId: media[2]!.id, altText: 'Pitch view 3', attribution: 'Photo: smoke venue' },
      { mediaId: media[0]!.id, altText: 'Pitch view 1', attribution: 'Photo: smoke venue' },
      { fileId: fourth.fileId, altText: 'Clubhouse', attribution: 'Photo: smoke venue' },
    ],
    coverIndex: 0,
  }, bongi, marker);
  const rejected = await service.rejectChange(pending.pendingContentChange!.id, 'Wrong clubhouse photo', alice, marker);
  assert(rejected.media.map(({ url }) => url).join() === [first, second, third].map(({ url }) => url).join(), 'Rejecting changed the live gallery.');
  const files = await readdir(folder);
  assert(!files.some((name) => fourth.url.endsWith(name)), 'The rejected upload was not deleted.');
  assert(files.length === 6, `Expected the 3 live photos and thumbnails on disk, found ${files.length} files.`);
  const audit = await prisma.adminAuditLog.count({ where: { requestId: marker, action: { in: ['VENUE_CONTENT_CHANGE_SUBMITTED', 'VENUE_CONTENT_CHANGE_APPROVED', 'VENUE_CONTENT_CHANGE_REJECTED'] } } });
  assert(audit === 4, `Expected 4 audited content decisions, found ${audit}.`);
  console.log('Venue photos smoke passed: uploads are processed (1600 px WebP + 400 px thumbnail, no metadata), a live venue stays live while a photo change waits, only a second admin can approve it, approval applies the photos and cover for players, and rejection keeps the live gallery and deletes the staged upload.');
} finally {
  await venue.cleanupVenue().catch(() => undefined);
  // The two admins stay in the disposable test database: their audit entries are append-only.
  await rm(folder, { recursive: true, force: true });
  await prisma.$disconnect();
}
