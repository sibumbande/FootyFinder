import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayerPhotoStorage } from './player-photo.storage.js';

const directories: string[] = [];
const storage = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'footy-player-photo-'));
  directories.push(directory);
  return new PlayerPhotoStorage(directory);
};
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('PlayerPhotoStorage', () => {
  it('normalizes a valid image to a private square WEBP without writing the original', async () => {
    const input = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#147d43' } }).png().toBuffer();
    const target = await storage();
    const saved = await target.save({ buffer: input, mimetype: 'image/png', size: input.length }, {});
    expect(saved).toMatchObject({ mimeType: 'image/webp', width: 512, height: 512 });
    const metadata = await sharp(await readFile(target.path(saved.fileKey))).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512 });
  });

  it('rejects spoofed MIME, undersized images, and invalid crop bounds', async () => {
    const target = await storage();
    const small = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).png().toBuffer();
    await expect(target.save({ buffer: small, mimetype: 'image/jpeg', size: small.length }, {})).rejects.toMatchObject({ code: 'PLAYER_PHOTO_INVALID' });
    await expect(target.save({ buffer: small, mimetype: 'image/png', size: small.length }, {})).rejects.toMatchObject({ code: 'PLAYER_PHOTO_INVALID' });
    const large = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } }).jpeg().toBuffer();
    await expect(target.save({ buffer: large, mimetype: 'image/jpeg', size: large.length }, { left: 250, top: 0, size: 100 })).rejects.toMatchObject({ code: 'PLAYER_PHOTO_CROP_INVALID' });
  });
});
