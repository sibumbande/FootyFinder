import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';

export const createPublicMatchSlug = () => `m-${randomBytes(12).toString('hex')}`;

export const publicMatchUrl = (slug: string) =>
  new URL(`/m/${slug}`, env.CLIENT_URL).toString();
