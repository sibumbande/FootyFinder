// CEO touch-up batch 3.5, item 7: makes the home hero's optimised sizes from the original photo.
// Run from the repo root: node apps/web/scripts/build-hero-images.mjs
// The original (apps/web/public/hero-cape-town.jpg, 6144 px, 2.7 MB) stays out of git; the outputs are committed.
// Uses the sharp that apps/api already depends on, so the web app gains no dependency.
import { createRequire } from 'node:module';
import { mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const sharp = require('sharp');
const source = fileURLToPath(new URL('../public/hero-cape-town.jpg', import.meta.url));
const outDir = fileURLToPath(new URL('../public/hero/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const WIDTHS = [640, 960, 1280, 1920, 2560];
for (const width of WIDTHS) {
  const file = `${outDir}cape-town-${width}.webp`;
  await sharp(source).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: width <= 960 ? 70 : 72, effort: 6 }).toFile(file);
  console.log(file, `${Math.round(statSync(file).size / 1024)} KB`);
}
// A JPEG for the few browsers without WebP.
const jpeg = `${outDir}cape-town-1280.jpg`;
await sharp(source).rotate().resize({ width: 1280 }).jpeg({ quality: 72, mozjpeg: true }).toFile(jpeg);
console.log(jpeg, `${Math.round(statSync(jpeg).size / 1024)} KB`);
