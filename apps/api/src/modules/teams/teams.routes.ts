import { Router, type Router as ExpressRouter } from 'express';
import { matchFormatRouteParamSchema } from '@footy-finder/shared';
import multer from 'multer';
import { AppError } from '../../errors/app-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import { registerRouteParam, registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './teams.controller.js';
import * as teamWallet from '../team-wallet/team-wallet.controller.js';
import * as teamChat from '../team-chat/team-chat.controller.js';
import * as teamReviews from '../team-reviews/team-reviews.controller.js';
import { TEAM_IMAGE_MAX_BYTES } from './team-image.storage.js';
import { costlyMutationRateLimit, messageRateLimit } from '../../middleware/rate-limit.js';
import { requireOnboardingForMutations } from '../../middleware/require-onboarding.js';

export const teamImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: TEAM_IMAGE_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNameSize: 100,
    fieldNestingDepth: 0,
  },
  fileFilter: (_req, file, done) =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)
      ? done(null, true)
      : done(new AppError(400, 'Upload a PNG, JPEG, or WEBP image.', 'TEAM_IMAGE_INVALID')),
});

export const teamsRouter: ExpressRouter = Router();
registerUuidRouteParams(teamsRouter, ['teamId', 'userId', 'inviteId', 'slotId', 'reviewId']);
registerRouteParam(teamsRouter, 'format', matchFormatRouteParamSchema);
teamsRouter.get('/', controller.list);
teamsRouter.post('/', costlyMutationRateLimit, controller.create);
teamsRouter.get('/:teamId', controller.get);
teamsRouter.patch('/:teamId', controller.update);
teamsRouter.delete('/:teamId', controller.remove);
teamsRouter.post('/:teamId/matches', costlyMutationRateLimit, controller.createMatch);
teamsRouter.get('/:teamId/matches', controller.matches);
// Gate 8 / TKT-809 (DEC-017): anonymous public reviews; members of the team may report one.
teamsRouter.get('/:teamId/reviews', teamReviews.teamSummary);
teamsRouter.post('/:teamId/reviews/:reviewId/report', costlyMutationRateLimit, teamReviews.report);
teamsRouter.post(
  '/:teamId/image',
  costlyMutationRateLimit,
  teamImageUpload.single('image'),
  controller.uploadImage,
);
teamsRouter.get('/:teamId/members', controller.members);
teamsRouter.patch('/:teamId/members/:userId', controller.updateMemberRole);
teamsRouter.delete('/:teamId/members/:userId', controller.removeMember);
teamsRouter.post('/:teamId/invites', costlyMutationRateLimit, controller.createInvite);
teamsRouter.get('/:teamId/invites', controller.listInvites);
teamsRouter.delete('/:teamId/invites/:inviteId', controller.revokeInvite);
teamsRouter.get('/:teamId/formations/:format', controller.getFormation);
// Gate 7 (TKT-702): Team Wallet.
teamsRouter.get('/:teamId/wallet', teamWallet.summary);
teamsRouter.get('/:teamId/wallet/transactions', teamWallet.transactions);
teamsRouter.get('/:teamId/wallet/holds', teamWallet.holds);
teamsRouter.post('/:teamId/wallet/contributions', costlyMutationRateLimit, teamWallet.contribute);
teamsRouter.post('/:teamId/wallet/refunds', costlyMutationRateLimit, teamWallet.refund);
// Gate 7 (TKT-710): team chat.
teamsRouter.get('/:teamId/chat/messages', teamChat.history);
teamsRouter.post('/:teamId/chat/messages', messageRateLimit, teamChat.send);
teamsRouter.post('/:teamId/chat/read', teamChat.markRead);
teamsRouter.put('/:teamId/formations/:format', controller.saveFormation);
teamsRouter.patch('/:teamId/formations/:format/slots/:slotId', controller.updateFormationSlot);

export const teamInvitesRouter: ExpressRouter = Router();
teamInvitesRouter.get('/:token', controller.inspectInvite);
teamInvitesRouter.post(
  '/:token/accept',
  requireAuth,
  requireOnboardingForMutations,
  costlyMutationRateLimit,
  controller.acceptInvite,
);
