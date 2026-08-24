import type { Request } from 'express';
import { AUTH_COOKIE_NAME } from './token.service.js';

export const bearerToken = (authorization: string | undefined) =>
  authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;

export const requestAuthToken = (req: Request) =>
  bearerToken(req.headers.authorization) ?? req.cookies?.[AUTH_COOKIE_NAME];
