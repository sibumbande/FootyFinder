import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PhotoCropInput } from '@footy-finder/shared';
import { AppError } from '../../errors/app-error.js';
import { LocalFileStorage } from '../../storage/file-storage.js';

export const PLAYER_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const supportedFormats = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const FILE_KEY = /^[0-9a-f-]{36}\.webp$/i;

export interface PlayerPhotoInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface StoredPlayerPhoto {
  fileKey: string;
  mimeType: 'image/webp';
  byteSize: number;
  width: number;
  height: number;
}

export class PlayerPhotoStorage {
  // CEO touch-up batch 3 (D2): files go through the shared storage (local disk today, R2 before launch).
  private readonly files: LocalFileStorage;
  constructor(directory: string) { this.files = new LocalFileStorage(directory); }

  async save(file: PlayerPhotoInput, crop: PhotoCropInput): Promise<StoredPlayerPhoto> {
    const expectedFormat = supportedFormats.get(file.mimetype);
    if (!expectedFormat || file.size > PLAYER_PHOTO_MAX_BYTES)
      throw new AppError(400, 'Upload a JPEG, PNG, or WEBP image up to 5 MB.', 'PLAYER_PHOTO_INVALID');
    let oriented: Buffer;
    let width: number;
    let height: number;
    let format: string;
    try {
      const result = await sharp(file.buffer, { failOn: 'warning' }).rotate().toBuffer({ resolveWithObject: true });
      oriented = result.data;
      width = result.info.width;
      height = result.info.height;
      format = result.info.format;
    } catch {
      throw new AppError(400, 'The uploaded image could not be decoded.', 'PLAYER_PHOTO_INVALID');
    }
    if (format !== expectedFormat || width < 256 || height < 256)
      throw new AppError(400, 'Upload a genuine image at least 256 by 256 pixels.', 'PLAYER_PHOTO_INVALID');

    const size = crop.size ?? Math.min(width, height);
    const left = crop.left ?? Math.floor((width - size) / 2);
    const top = crop.top ?? Math.floor((height - size) / 2);
    if (size < 1 || left < 0 || top < 0 || left + size > width || top + size > height)
      throw new AppError(400, 'The selected square crop is outside the image.', 'PLAYER_PHOTO_CROP_INVALID');
    const normalized = await sharp(oriented)
      .extract({ left, top, width: size, height: size })
      .resize(512, 512, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();
    const fileKey = `${randomUUID()}.webp`;
    await this.files.put(fileKey, normalized);
    return { fileKey, mimeType: 'image/webp', byteSize: normalized.byteLength, width: 512, height: 512 };
  }

  path(fileKey: string) {
    if (!FILE_KEY.test(fileKey))
      throw new AppError(404, 'Player photo not found.', 'PLAYER_PHOTO_NOT_FOUND');
    return this.files.path(fileKey);
  }

  async delete(fileKey: string) {
    if (!FILE_KEY.test(fileKey)) return;
    await this.files.delete(fileKey);
  }
}
