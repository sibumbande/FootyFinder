import type { VenueContentInput, VenueContentPayload, VenuePhotoUpload } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { serializableTransaction } from '../../database/transaction.js';
import { AppError } from '../../errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { LocalFileStorage } from '../../storage/file-storage.js';
import { VenuePhotoStorage, type VenuePhotoInput } from '../venues/venue-photo.storage.js';
import { appendAdminAudit } from './admin-audit.js';
import { assertIndependentVenueApprover, include, markVenueDraft, venueDto } from './admin-catalog.service.js';

type Tx = Prisma.TransactionClient;
/** Staged uploads that nobody saved are removed after a day. */
const STAGED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export const venuePhotoFiles = () =>
  new LocalFileStorage(env.VENUE_UPLOAD_DIR, `${env.PUBLIC_API_URL.replace(/\/$/, '')}/uploads/venues`);

/**
 * CEO touch-up batch 3, item 1 (D1): venue photos are uploaded first (processed and staged), then saved as
 * the venue's gallery in one go. On a draft venue the save applies straight away (and, as for every
 * catalogue edit, the venue needs submitting again). On a live venue the save becomes a pending change: the
 * venue stays live with its current photos until a second MFA-verified admin approves it, or it is rejected.
 */
export class VenueContentService {
  constructor(private readonly photos = new VenuePhotoStorage(venuePhotoFiles())) {}

  async uploadPhoto(venueId: string, file: VenuePhotoInput, actorUserId: string, requestId?: string): Promise<VenuePhotoUpload> {
    await prisma.managedVenue.findUniqueOrThrow({ where: { id: venueId }, select: { id: true } });
    const stored = await this.photos.save(file);
    try {
      const row = await serializableTransaction(async (tx) => {
        const created = await tx.venuePhotoFile.create({
          data: { venueId, storageKey: stored.storageKey, thumbKey: stored.thumbKey, width: stored.width, height: stored.height, byteSize: stored.byteSize, uploadedByUserId: actorUserId },
        });
        await appendAdminAudit(tx, { actorUserId, action: 'VENUE_PHOTO_UPLOADED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId, metadata: { fileId: created.id } });
        return created;
      });
      return { fileId: row.id, url: this.photos.url(row.storageKey), thumbUrl: this.photos.url(row.thumbKey), width: row.width, height: row.height };
    } catch (error) {
      await this.photos.delete(stored.storageKey, stored.thumbKey);
      throw error;
    }
  }

  async saveContent(venueId: string, input: VenueContentInput, actorUserId: string, requestId?: string) {
    const { venue, removed } = await serializableTransaction(async (tx) => {
      const current = await tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include: { media: true } });
      const payload = await this.resolve(tx, venueId, current.media, input);
      let removed: string[] = [];
      if (current.publicationStatus === 'PUBLISHED') {
        await tx.venueContentChange.updateMany({
          where: { venueId, status: 'PENDING' },
          data: { status: 'SUPERSEDED', decidedByUserId: actorUserId, decidedAt: new Date(), decisionReason: 'Replaced by a newer change.' },
        });
        const change = await tx.venueContentChange.create({ data: { venueId, payload: payload as unknown as Prisma.InputJsonValue, submittedByUserId: actorUserId } });
        await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CONTENT_CHANGE_SUBMITTED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId, metadata: { changeId: change.id, photoCount: payload.photos.length } });
      } else {
        removed = await applyContent(tx, venueId, payload);
        await markVenueDraft(tx, venueId);
        await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CONTENT_UPDATED', entityType: 'MANAGED_VENUE', entityId: venueId, requestId, metadata: { photoCount: payload.photos.length } });
      }
      return { venue: await tx.managedVenue.findUniqueOrThrow({ where: { id: venueId }, include }), removed };
    });
    await this.cleanUp(venueId, removed);
    return venueDto(venue);
  }

  async approveChange(changeId: string, actorUserId: string, requestId?: string) {
    const { venue, removed } = await serializableTransaction(async (tx) => {
      const change = await tx.venueContentChange.findUniqueOrThrow({ where: { id: changeId }, include: { venue: { select: { publicationStatus: true } } } });
      if (change.status !== 'PENDING') throw new AppError(409, 'This change is no longer waiting for approval.', 'VENUE_CHANGE_NOT_PENDING');
      assertIndependentVenueApprover(change.submittedByUserId, actorUserId);
      if (change.venue.publicationStatus !== 'PUBLISHED')
        throw new AppError(409, 'This venue is no longer live. Edit its photos directly and submit it for approval.', 'VENUE_NOT_LIVE');
      const removed = await applyContent(tx, change.venueId, change.payload as unknown as VenueContentPayload);
      await tx.venueContentChange.update({ where: { id: changeId }, data: { status: 'APPROVED', decidedByUserId: actorUserId, decidedAt: new Date() } });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CONTENT_CHANGE_APPROVED', entityType: 'MANAGED_VENUE', entityId: change.venueId, requestId, metadata: { changeId } });
      return { venue: await tx.managedVenue.findUniqueOrThrow({ where: { id: change.venueId }, include }), removed };
    });
    await this.cleanUp(venue.id, removed);
    return venueDto(venue);
  }

  async rejectChange(changeId: string, reason: string, actorUserId: string, requestId?: string) {
    const { venue, discarded } = await serializableTransaction(async (tx) => {
      const change = await tx.venueContentChange.findUniqueOrThrow({ where: { id: changeId } });
      if (change.status !== 'PENDING') throw new AppError(409, 'This change is no longer waiting for approval.', 'VENUE_CHANGE_NOT_PENDING');
      await tx.venueContentChange.update({ where: { id: changeId }, data: { status: 'REJECTED', decidedByUserId: actorUserId, decidedAt: new Date(), decisionReason: reason } });
      await appendAdminAudit(tx, { actorUserId, action: 'VENUE_CONTENT_CHANGE_REJECTED', entityType: 'MANAGED_VENUE', entityId: change.venueId, requestId, metadata: { changeId, reason } });
      const discarded = (change.payload as unknown as VenueContentPayload).photos.flatMap(({ storageKey }) => (storageKey ? [storageKey] : []));
      return { venue: await tx.managedVenue.findUniqueOrThrow({ where: { id: change.venueId }, include }), discarded };
    });
    // Uploads used only by the rejected change go now; live photos are kept by cleanUp.
    await this.cleanUp(venue.id, discarded);
    return venueDto(venue);
  }

  private async resolve(tx: Tx, venueId: string, media: Array<{ id: string; url: string; thumbUrl: string | null; storageKey: string | null }>, input: VenueContentInput): Promise<VenueContentPayload> {
    const fileIds = input.photos.flatMap(({ fileId }) => (fileId ? [fileId] : []));
    const files = fileIds.length ? await tx.venuePhotoFile.findMany({ where: { venueId, id: { in: fileIds } } }) : [];
    const photos = input.photos.map((photo) => {
      if (photo.mediaId) {
        const existing = media.find(({ id }) => id === photo.mediaId);
        if (!existing) throw new AppError(400, 'One of the photos is no longer part of this venue. Reload and try again.', 'VENUE_PHOTO_UNKNOWN');
        return { url: existing.url, ...(existing.thumbUrl ? { thumbUrl: existing.thumbUrl } : {}), altText: photo.altText, attribution: photo.attribution, ...(existing.storageKey ? { storageKey: existing.storageKey } : {}) };
      }
      const file = files.find(({ id }) => id === photo.fileId);
      if (!file) throw new AppError(400, 'One of the uploaded photos was not found. Upload it again.', 'VENUE_PHOTO_UNKNOWN');
      return { url: this.photos.url(file.storageKey), thumbUrl: this.photos.url(file.thumbKey), altText: photo.altText, attribution: photo.attribution, storageKey: file.storageKey };
    });
    if (new Set(photos.map(({ url }) => url)).size !== photos.length) throw new AppError(400, 'The same photo appears twice.', 'VENUE_PHOTO_DUPLICATE');
    return { photos, coverIndex: input.coverIndex };
  }

  /**
   * Deletes the files of photos that left the live gallery, and staged uploads older than a day that are
   * neither live nor in the pending change.
   */
  private async cleanUp(venueId: string, removedStorageKeys: string[]) {
    const [live, pending, files] = await Promise.all([
      prisma.managedVenueMedia.findMany({ where: { venueId }, select: { storageKey: true } }),
      prisma.venueContentChange.findFirst({ where: { venueId, status: 'PENDING' }, select: { payload: true } }),
      prisma.venuePhotoFile.findMany({ where: { venueId } }),
    ]);
    const inUse = new Set<string>(live.flatMap(({ storageKey }) => (storageKey ? [storageKey] : [])));
    for (const photo of (pending?.payload as unknown as VenueContentPayload | undefined)?.photos ?? []) if (photo.storageKey) inUse.add(photo.storageKey);
    const removed = new Set(removedStorageKeys);
    const stale = Date.now() - STAGED_UPLOAD_TTL_MS;
    for (const file of files) {
      if (inUse.has(file.storageKey)) continue;
      if (!removed.has(file.storageKey) && file.createdAt.getTime() > stale) continue;
      await prisma.venuePhotoFile.delete({ where: { id: file.id } }).catch(() => undefined);
      await this.photos.delete(file.storageKey, file.thumbKey);
    }
  }
}

/** Replaces the live gallery and cover with `payload`; returns the storage keys of photos no longer used. */
async function applyContent(tx: Tx, venueId: string, payload: VenueContentPayload) {
  const before = await tx.managedVenueMedia.findMany({ where: { venueId }, select: { storageKey: true } });
  await tx.managedVenueMedia.deleteMany({ where: { venueId } });
  await tx.managedVenueMedia.createMany({
    data: payload.photos.map((photo, sortOrder) => ({
      venueId, sortOrder, url: photo.url, thumbUrl: photo.thumbUrl ?? null, altText: photo.altText, attribution: photo.attribution, storageKey: photo.storageKey ?? null,
    })),
  });
  const cover = payload.photos[payload.coverIndex]!;
  await tx.managedVenue.update({ where: { id: venueId }, data: { coverImageUrl: cover.url, coverImageAlt: cover.altText, coverImageAttribution: cover.attribution } });
  const kept = new Set(payload.photos.flatMap(({ storageKey }) => (storageKey ? [storageKey] : [])));
  return before.flatMap(({ storageKey }) => (storageKey && !kept.has(storageKey) ? [storageKey] : []));
}
