import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../errors/app-error.js';
import type { LocalFileStorage } from '../../storage/file-storage.js';

/**
 * CEO touch-up batch 3, item 1 (D3, D4): venue photos uploaded by an admin from a computer or phone gallery.
 * Every photo is decoded and re-encoded server-side, so camera metadata (including GPS location) is never
 * kept: a 1600 px (longest side) WebP for the gallery and a 400 px thumbnail. HEIC is not accepted; iPhones
 * convert gallery photos to JPEG automatically for an upload that accepts only JPEG, PNG and WebP.
 */
export const VENUE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const supportedFormats = new Map([
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export interface VenuePhotoInput {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface StoredVenuePhoto {
  storageKey: string;
  thumbKey: string;
  width: number;
  height: number;
  byteSize: number;
}

export class VenuePhotoStorage {
  constructor(private readonly files: LocalFileStorage) {}

  async save(file: VenuePhotoInput): Promise<StoredVenuePhoto> {
    const expectedFormat = supportedFormats.get(file.mimetype);
    if (!expectedFormat || file.size > VENUE_PHOTO_MAX_BYTES)
      throw new AppError(400, 'Upload a JPG, PNG or WebP photo up to 10 MB. iPhone HEIC photos: save as JPG first.', 'VENUE_PHOTO_INVALID');
    let oriented: Buffer;
    let format: string;
    let width: number;
    let height: number;
    try {
      const result = await sharp(file.buffer, { failOn: 'warning' }).rotate().toBuffer({ resolveWithObject: true });
      oriented = result.data;
      format = result.info.format;
      width = result.info.width;
      height = result.info.height;
    } catch {
      throw new AppError(400, 'The photo could not be read. Try a JPG, PNG or WebP file.', 'VENUE_PHOTO_INVALID');
    }
    if (format !== expectedFormat || width < 400 || height < 300)
      throw new AppError(400, 'Upload a real photo at least 400 by 300 pixels.', 'VENUE_PHOTO_INVALID');
    const full = await sharp(oriented)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(oriented).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    const id = randomUUID();
    const storageKey = `${id}.webp`;
    const thumbKey = `${id}-thumb.webp`;
    await this.files.put(storageKey, full.data);
    try {
      await this.files.put(thumbKey, thumb);
    } catch (error) {
      await this.files.delete(storageKey);
      throw error;
    }
    return { storageKey, thumbKey, width: full.info.width, height: full.info.height, byteSize: full.data.byteLength };
  }

  async delete(storageKey: string, thumbKey?: string | null) {
    await this.files.delete(storageKey);
    if (thumbKey) await this.files.delete(thumbKey);
  }

  url(key: string) {
    return this.files.publicUrl(key);
  }
}
