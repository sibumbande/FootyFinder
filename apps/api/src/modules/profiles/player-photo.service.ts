import type { PhotoCropInput } from '@footy-finder/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { AppError } from '../../errors/app-error.js';
import { appendAdminAudit } from '../admin/admin-audit.js';
import { notificationDedupeKey, persistNotifications } from '../notifications/notification-writer.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlayerPhotoStorage, type PlayerPhotoInput } from './player-photo.storage.js';

export class PlayerPhotoService {
  constructor(
    private readonly storage = new PlayerPhotoStorage(env.PLAYER_UPLOAD_DIR),
    private readonly notifications = new NotificationsService(),
  ) {}

  async replace(userId: string, file: PlayerPhotoInput | undefined, crop: PhotoCropInput) {
    if (!file) throw new AppError(400, 'Choose a player photo to upload.', 'PLAYER_PHOTO_INVALID');
    const profile = await prisma.playerProfile.findUnique({ where: { userId }, include: { photo: true } });
    if (!profile) throw new AppError(404, 'Player profile not found.', 'PLAYER_NOT_FOUND');
    const stored = await this.storage.save(file, crop);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.playerPhoto.upsert({
          where: { profileId: profile.id },
          create: { profileId: profile.id, ...stored },
          update: { ...stored, hiddenAt: null, hiddenReason: null, moderatedByUserId: null },
        });
        await tx.playerProfile.update({
          where: { id: profile.id },
          data: { avatarUrl: null, onboardingStatus: 'IN_PROGRESS' },
        });
      });
    } catch (error) {
      await this.storage.delete(stored.fileKey);
      throw error;
    }
    if (profile.photo && profile.photo.fileKey !== stored.fileKey)
      await this.storage.delete(profile.photo.fileKey);
    return { success: true };
  }

  async filePath(userId: string) {
    const photo = await prisma.playerPhoto.findFirst({
      where: { profile: { userId }, hiddenAt: null },
      select: { fileKey: true },
    });
    if (!photo) throw new AppError(404, 'Player photo not found.', 'PLAYER_PHOTO_NOT_FOUND');
    return this.storage.path(photo.fileKey);
  }

  async hide(userId: string, adminUserId: string, reason: string, requestId: string) {
    const profile = await prisma.playerProfile.findUnique({ where: { userId }, include: { photo: true } });
    if (!profile?.photo) throw new AppError(404, 'Player photo not found.', 'PLAYER_PHOTO_NOT_FOUND');
    const notifications = await prisma.$transaction(async (tx) => {
      await tx.playerPhoto.update({
        where: { id: profile.photo!.id },
        data: { hiddenAt: new Date(), hiddenReason: reason, moderatedByUserId: adminUserId },
      });
      await tx.playerProfile.update({ where: { id: profile.id }, data: { onboardingStatus: 'IN_PROGRESS' } });
      await tx.user.update({ where: { id: userId }, data: { onboardingCompletedAt: null } });
      await appendAdminAudit(tx, {
        actorUserId: adminUserId,
        action: 'PLAYER_PHOTO_HIDDEN',
        entityType: 'USER',
        entityId: userId,
        requestId,
        metadata: { reason },
      });
      return persistNotifications(tx, [{
        userId,
        type: 'INFO',
        title: 'Profile photo needs replacement',
        message: 'Your profile photo was hidden after moderation. Upload a compliant replacement to restore profile completion.',
        targetPath: '/onboarding',
        dedupeKey: notificationDedupeKey('player-photo-hidden', profile.photo!.id, profile.photo!.updatedAt.toISOString()),
      }]);
    });
    this.notifications.publishPersistedMany(notifications);
    return { success: true };
  }
}
