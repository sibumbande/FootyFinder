import type { Request, RequestHandler } from 'express';
import { env } from '../config/env.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number, now?: number): RateLimitResult;
}

type Entry = { count: number; resetsAt: number };

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, Entry>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const current = this.entries.get(key);
    const entry =
      !current || current.resetsAt <= now ? { count: 0, resetsAt: now + windowMs } : current;
    entry.count += 1;
    this.entries.set(key, entry);
    if (this.entries.size > 10_000)
      for (const [storedKey, stored] of this.entries)
        if (stored.resetsAt <= now) this.entries.delete(storedKey);
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetsAt - now) / 1000)),
    };
  }

  clear() {
    this.entries.clear();
  }
}

export const rateLimitStore = new InMemoryRateLimitStore();

const actorKey = (req: Request, userId: unknown) =>
  typeof userId === 'string' && userId ? `user:${userId}` : `ip:${req.ip}`;

export const createRateLimit =
  ({
    scope,
    limit,
    windowMs,
    store = rateLimitStore,
  }: {
    scope: string;
    limit: number;
    windowMs: number;
    store?: RateLimitStore;
  }): RequestHandler =>
  (req, res, next) => {
    const result = store.consume(
      `${scope}:${actorKey(req, res.locals.authUserId)}`,
      limit,
      windowMs,
    );
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.allowed) return next();
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    res.status(429).json({
      error: 'Too many requests. Please wait before trying again.',
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: result.retryAfterSeconds },
    });
  };

export const authRateLimit = createRateLimit({
  scope: 'auth',
  limit: env.RATE_LIMIT_AUTH_PER_15_MINUTES,
  windowMs: 15 * 60_000,
});

export const messageRateLimit = createRateLimit({
  scope: 'messages',
  limit: env.RATE_LIMIT_MESSAGES_PER_MINUTE,
  windowMs: 60_000,
});

export const costlyMutationRateLimit = createRateLimit({
  scope: 'costly-mutation',
  limit: env.RATE_LIMIT_COSTLY_MUTATIONS_PER_MINUTE,
  windowMs: 60_000,
});
