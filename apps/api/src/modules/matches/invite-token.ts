import { createHash, randomBytes } from 'node:crypto';

export const createMatchInviteToken = () => randomBytes(32).toString('base64url');

export const hashMatchInviteToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');
