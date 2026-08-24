import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { logInfo } from '../observability/logger.js';

const requestIdPattern = /^[A-Za-z0-9._-]{8,100}$/;
export const redactedRequestPath = (path: string) =>
  path
    .replace(/^(\/matches\/invite\/)[^/]+/i, '$1[REDACTED]')
    .replace(/^(\/team-invites\/)[^/]+/i, '$1[REDACTED]');

export const requestContext: RequestHandler = (req, res, next) => {
  const supplied = req.get('x-request-id');
  const requestId = supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
  const startedAt = Date.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  if (env.NODE_ENV !== 'test')
    res.on('finish', () =>
      logInfo('http_request', {
        requestId,
        method: req.method,
        path: redactedRequestPath(req.originalUrl.split('?')[0] ?? req.path),
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: res.locals.authUserId,
      }),
    );
  next();
};
