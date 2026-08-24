import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export const AUTH_COOKIE_NAME = 'footy_finder_session';

export interface AuthTokenPayload {
  sub: string;
  sid?: string;
  iat?: number;
}

export class TokenService {
  sign(userId: string, sessionId: string) {
    return jwt.sign({ sid: sessionId }, env.JWT_SECRET, {
      subject: userId,
      expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    });
  }

  verify(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === 'string' || !payload.sub) throw new Error('Invalid token payload');
    return {
      sub: payload.sub,
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      iat: payload.iat,
    };
  }
}
