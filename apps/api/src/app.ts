import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { corsOptions } from './config/cors.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { requireAuth } from './middleware/require-auth.js';
import { requireOnboardingForMutations } from './middleware/require-onboarding.js';
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
import { socialRouter } from './modules/social/social.routes.js';
import { publicRouter } from './modules/public/public.routes.js';
import { refereeRouter } from './modules/referees/referee.routes.js';
import { adminAuthRouter, adminRouter } from './modules/admin/admin.routes.js';
import { requireAdminMfa, requirePlatformAdmin } from './middleware/require-admin.js';
import { supportRouter } from './modules/support/support.routes.js';
import { bookingsRouter } from './modules/bookings/bookings.routes.js';
import { moderationRouter } from './modules/moderation/moderation.routes.js';
import { disputesRouter } from './modules/disputes/disputes.routes.js';
import { OperationsService } from './modules/admin/operations.service.js';
import { logError } from './observability/logger.js';
import { onboardingRouter } from './modules/onboarding/onboarding.routes.js';
import { legalRouter } from './modules/legal/legal.routes.js';
import { citiesRouter } from './modules/cities/cities.routes.js';
import { venuesRouter } from './modules/venues/venues.routes.js';
import { publicMatchesRouter } from './modules/matches/public-matches.routes.js';
import { createPaystackWebhookRouter } from './modules/payments/paystack-webhook.js';
export const app: Express = express();
const operations = new OperationsService();
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
// TKT-605: must run before express.json() so the signature is checked on the exact raw body.
app.use('/payments', createPaystackWebhookRouter());
app.use(express.json());
app.use(cookieParser());
app.use(requireTrustedCookieOrigin);
app.use(
  '/uploads/teams',
  express.static(resolve(env.TEAM_UPLOAD_DIR), { fallthrough: false, maxAge: '1h' }),
);
app.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
app.get('/ready', async (_req, res) => {
  try {
    res.json({ data: await operations.readiness() });
  } catch (error) {
    logError('readiness_check_failed', error);
    res.status(503).json({ data: { status: 'not_ready', database: 'unavailable' } });
  }
});
app.use('/auth', authRouter);
app.use('/legal', legalRouter);
app.use('/cities', citiesRouter);
app.use('/venues', venuesRouter);
app.use('/public/matches', publicMatchesRouter);
app.use('/public', publicRouter);
app.use('/onboarding', onboardingRouter);
app.use('/players', profilesRouter);
app.use('/users', usersRouter);
app.use('/matches', requireAuth, requireOnboardingForMutations, matchesRouter);
app.use('/wallet', requireAuth, requireOnboardingForMutations, walletRouter);
app.use('/conversations', requireAuth, requireOnboardingForMutations, messagingRouter);
app.use('/notifications', requireAuth, notificationsRouter);
app.use('/support', requireAuth, supportRouter);
app.use('/bookings', requireAuth, requireOnboardingForMutations, bookingsRouter);
app.use('/moderation', requireAuth, moderationRouter);
app.use('/disputes', requireAuth, disputesRouter);
app.use('/teams', requireAuth, requireOnboardingForMutations, teamsRouter);
app.use('/referee', requireAuth, refereeRouter);
app.use('/team-invites', teamInvitesRouter);
app.use('/social', requireAuth, requireOnboardingForMutations, socialRouter);
app.use('/admin/auth', requireAuth, requirePlatformAdmin, adminAuthRouter);
app.use('/admin', requireAuth, requirePlatformAdmin, requireAdminMfa, adminRouter);
app.use(errorHandler);
