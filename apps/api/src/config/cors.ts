import type { CorsOptions } from 'cors';
import { env } from './env.js';

/**
 * Browser origins allowed to read API responses. Requests without an Origin
 * header are permitted so server-to-server clients and local CLI tools work.
 */
export const allowedOrigins = [
  ...new Set([new URL(env.CLIENT_URL).origin, new URL(env.ADMIN_CLIENT_URL).origin]),
];

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Returning false omits CORS response headers, so the browser blocks the caller.
    callback(null, false);
  },
  credentials: true,
  // CEO touch-up batch 3.5, item 4: lets the admin app read a download's file name.
  exposedHeaders: ['Content-Disposition'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  maxAge: 86_400,
  optionsSuccessStatus: 204,
};
