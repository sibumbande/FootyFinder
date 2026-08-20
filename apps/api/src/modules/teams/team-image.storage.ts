import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { AppError } from '../../errors/app-error.js';

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
const extensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const hasValidSignature = (file: TeamImageInput) => {
  const bytes = file.buffer;
  if (file.mimetype === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (file.mimetype === 'image/webp')
    return (
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    );
  return false;
};

export class LocalTeamImageStorage implements TeamImageStorage {
  private readonly directory: string;
  constructor(
    directory: string,
    private readonly publicBaseUrl: string,
  ) {
    this.directory = resolve(directory);
  }
  async save(file: TeamImageInput) {
    const extension = extensions[file.mimetype];
    if (!extension || file.size > TEAM_IMAGE_MAX_BYTES || !hasValidSignature(file))
      throw new AppError(
        400,
        'Upload a valid PNG, JPEG, or WEBP image up to 5 MB.',
        'TEAM_IMAGE_INVALID',
      );
    await mkdir(this.directory, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    await writeFile(resolve(this.directory, filename), file.buffer, { flag: 'wx' });
    return `${this.publicBaseUrl.replace(/\/$/, '')}/uploads/teams/${filename}`;
  }
  async delete(url: string) {
    const filename = basename(new URL(url).pathname);
    if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(filename) || !extname(filename)) return;
    const target = resolve(this.directory, filename);
    if (!target.startsWith(`${this.directory}\\`) && target !== this.directory) return;
    await unlink(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
