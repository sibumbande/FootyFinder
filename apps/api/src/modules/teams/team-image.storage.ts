import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../../errors/app-error.js';
import { LocalFileStorage } from '../../storage/file-storage.js';

export interface TeamImageInput {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export interface TeamImageStorage {
  save(file: TeamImageInput): Promise<string>;
  delete(url: string): Promise<void>;
}

export const TEAM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const formats: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

const invalid = () =>
  new AppError(400, 'Upload a valid PNG, JPEG, or WEBP image up to 5 MB.', 'TEAM_IMAGE_INVALID');

export class LocalTeamImageStorage implements TeamImageStorage {
  private readonly files: LocalFileStorage;
  constructor(directory: string, publicBaseUrl: string) {
    this.files = new LocalFileStorage(directory, `${publicBaseUrl.replace(/\/$/, '')}/uploads/teams`);
  }
  // CEO touch-up batch 3 (D2): crests are decoded and re-encoded like player and venue photos, so the
  // stored file is a clean WebP (at most 512 px) without camera metadata or location.
  async save(file: TeamImageInput) {
    const expected = formats[file.mimetype];
    if (!expected || file.size > TEAM_IMAGE_MAX_BYTES) throw invalid();
    let image: Buffer;
    try {
      const decoded = await sharp(file.buffer, { failOn: 'warning' }).rotate().toBuffer({ resolveWithObject: true });
      if (decoded.info.format !== expected) throw invalid();
      image = await sharp(decoded.data).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch {
      throw invalid();
    }
    const key = `${randomUUID()}.webp`;
    await this.files.put(key, image);
    return this.files.publicUrl(key);
  }
  async delete(url: string) {
    const key = this.files.keyFromPublicUrl(url);
    if (key) await this.files.delete(key);
  }
}
