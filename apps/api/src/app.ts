import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/require-auth.js';
import { requireTrustedCookieOrigin } from './middleware/origin-guard.js';
import { requestContext } from './middleware/request-context.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { matchesRouter } from './modules/matches/matches.routes.js';
import { messagingRouter } from './modules/messaging/messaging.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { profilesRouter } from './modules/profiles/profiles.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { walletRouter } from './modules/wallet/wallet.routes.js';
import { teamInvitesRouter, teamsRouter } from './modules/teams/teams.routes.js';
import { adminAuthRouter, adminRouter } from './modules/admin/admin.routes.js';
import { requireAdminMfa, requirePlatformAdmin } from './middleware/require-admin.js';
import { supportRouter } from './modules/support/support.routes.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { moderationRouter } from './modules/moderation/moderation.routes.js';
export const app: Express = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY_HOPS || false);
app.use(requestContext);
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: env.NODE_ENV === 'production' ? undefined : false,
  }),
);
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(requireTrustedCookieOrigin);
app.use(
  '/uploads/teams',
  express.static(resolve(env.TEAM_UPLOAD_DIR), { fallthrough: false, maxAge: '1h' }),
);
app.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.use('/auth', authRouter);
app.use('/players', profilesRouter);
app.use('/users', usersRouter);
app.use('/matches', requireAuth, matchesRouter);
app.use('/wallet', requireAuth, walletRouter);
app.use('/conversations', requireAuth, messagingRouter);
app.use('/notifications', requireAuth, notificationsRouter);
app.use('/support', requireAuth, supportRouter);
app.use('/bookings', requireAuth, bookingsRouter);
app.use('/moderation', requireAuth, moderationRouter);
app.use('/teams', requireAuth, teamsRouter);
app.use('/team-invites', teamInvitesRouter);
app.use('/admin/auth', requireAuth, requirePlatformAdmin, adminAuthRouter);
app.use('/admin', requireAuth, requirePlatformAdmin, requireAdminMfa, adminRouter);
app.use(errorHandler);
