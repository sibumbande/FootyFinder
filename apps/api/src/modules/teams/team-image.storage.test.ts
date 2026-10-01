import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalTeamImageStorage } from './team-image.storage.js';

const folders: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
async function storage() {
  const folder = await mkdtemp(join(tmpdir(), 'footy-team-images-'));
  folders.push(folder);
  return { folder, storage: new LocalTeamImageStorage(folder, 'http://localhost:3000') };
}
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe('LocalTeamImageStorage', () => {
  // CEO touch-up batch 3 (D2): crests are re-encoded to WebP without camera metadata or location.
  it('stores valid images re-encoded under a generated safe filename, without metadata', async () => {
    const { folder, storage: provider } = await storage();
    const image = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#123456' } })
      .png()
      .withExif({ IFD0: { Copyright: 'GPS secret' } })
      .toBuffer();
    const url = await provider.save({ buffer: image, size: image.length, mimetype: 'image/png', originalname: '../../escape.png' });
    expect(url).toMatch(/\/uploads\/teams\/[0-9a-f-]{36}\.webp$/);
    const meta = await sharp(await readFile(join(folder, url.split('/').at(-1)!))).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 512 });
    expect(meta.exif).toBeUndefined();
  });
  it.each([
    [
      'invalid MIME',
      { buffer: png, size: png.length, mimetype: 'text/plain', originalname: 'x.txt' },
    ],
    [
      'invalid signature',
      { buffer: Buffer.from('not png'), size: 7, mimetype: 'image/png', originalname: 'x.png' },
    ],
    [
      'oversized',
      { buffer: png, size: 5 * 1024 * 1024 + 1, mimetype: 'image/png', originalname: 'x.png' },
    ],
  ])('rejects %s', async (_label, file) => {
    const { storage: provider } = await storage();
    await expect(provider.save(file)).rejects.toMatchObject({ code: 'TEAM_IMAGE_INVALID' });
  });
  it('does not delete unrelated files', async () => {
    const { folder, storage: provider } = await storage();
    const unrelated = join(folder, 'keep.txt');
    await writeFile(unrelated, 'keep');
    await provider.delete('http://localhost:3000/uploads/teams/../../keep.txt');
    await expect(readFile(unrelated, 'utf8')).resolves.toBe('keep');
  });
});
