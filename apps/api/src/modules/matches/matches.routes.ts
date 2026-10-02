import { Router, type Router as ExpressRouter } from 'express';
import { teamSideRouteParamSchema } from '@footy-finder/shared';
import { registerRouteParam, registerUuidRouteParams } from '../../middleware/route-params.js';
import * as controller from './matches.controller.js';
import * as teamMatches from '../team-matches/team-matches.controller.js';
import * as resultEvidence from '../referees/result-evidence.controller.js';
import * as teamReviews from '../team-reviews/team-reviews.controller.js';
import * as tickets from '../tickets/tickets.controller.js';
import { costlyMutationRateLimit, messageRateLimit } from '../../middleware/rate-limit.js';
export const matchesRouter: ExpressRouter = Router();
registerUuidRouteParams(matchesRouter, ['id', 'slotId', 'participantId', 'userId']);
registerRouteParam(matchesRouter, 'side', teamSideRouteParamSchema);
matchesRouter.get('/', controller.list);
matchesRouter.post('/', costlyMutationRateLimit, controller.create);
matchesRouter.get('/invite/:token', controller.invite);
matchesRouter.get('/public/:slug', controller.getByPublicSlug);
matchesRouter.get('/:id', controller.get);
matchesRouter.post('/:id/invite', costlyMutationRateLimit, controller.rotateInvite);
matchesRouter.patch('/:id', controller.update);
matchesRouter.delete('/:id', controller.remove);
matchesRouter.post('/:id/ready', controller.ready);
matchesRouter.post('/:id/join', costlyMutationRateLimit, controller.join);
// DEC-021 A1: buy a ticket for one place; the viewer's ticket, credits and the cancellation policy.
matchesRouter.get('/:id/tickets/context', tickets.context);
matchesRouter.post('/:id/tickets/checkout', costlyMutationRateLimit, tickets.checkout);
// Gate 7 / DEC-019: take or withdraw from the other side of a team match.
matchesRouter.post('/:id/other-side/team', costlyMutationRateLimit, teamMatches.loadTeam);
matchesRouter.post('/:id/other-side/team/withdraw', teamMatches.withdrawTeam);
matchesRouter.get('/:id/team-sides/:side/meter', teamMatches.meter);
matchesRouter.post('/:id/team-sides/:side/meter/fill', costlyMutationRateLimit, teamMatches.fillMeter);
matchesRouter.patch('/:id/team-sides/:side/substitutes', teamMatches.changeSubstitutes);
matchesRouter.get('/:id/cancellation-quote', controller.cancellationQuote);
matchesRouter.get('/:id/cancellation-status', controller.cancellationStatus);
matchesRouter.post('/:id/leave', controller.leave);
matchesRouter.patch('/:id/formation/slots/:slotId', controller.formation);
matchesRouter.post('/:id/formation/slots/:slotId/claim', controller.claimPosition);
matchesRouter.patch('/:id/participants/:participantId/team', controller.changeTeam);
matchesRouter.post('/:id/result', controller.submitResult);
// Gate 8 / TKT-806 (DEC-020): the referee's result is final; captains may send their own version
// as evidence (D10, D11) and report a problem within 24 hours (D6).
matchesRouter.get('/:id/result-context', resultEvidence.resultContext);
matchesRouter.post('/:id/result-version', costlyMutationRateLimit, resultEvidence.submitVersion);
matchesRouter.post('/:id/result-problems', costlyMutationRateLimit, resultEvidence.reportProblem);
// Gate 8 / TKT-809 (DEC-017): rate the opposing team after the final result.
matchesRouter.get('/:id/review', teamReviews.context);
matchesRouter.post('/:id/review', costlyMutationRateLimit, teamReviews.create);
matchesRouter.patch('/:id/review', teamReviews.update);
matchesRouter.delete('/:id/review', teamReviews.remove);
matchesRouter.get('/:id/participants', controller.participants);
matchesRouter.post('/:id/team-sides/:side/availability/request', controller.requestAvailability);
matchesRouter.get('/:id/team-sides/:side/availability', controller.teamAvailability);
matchesRouter.put('/:id/team-sides/:side/availability/me', controller.updateMyAvailability);
matchesRouter.get('/:id/team-sides/:side/lineup', controller.lineup);
matchesRouter.put(
  '/:id/team-sides/:side/lineup/selections/:userId/invite',
  controller.inviteSelection,
);
matchesRouter.put(
  '/:id/team-sides/:side/lineup/slots/:slotId/player',
  controller.assignLineupStarter,
);
matchesRouter.post(
  '/:id/team-sides/:side/lineup/slots/:slotId/remove',
  controller.removeLineupStarter,
);
matchesRouter.post('/:id/team-sides/:side/lineup/slots/:slotId/open', controller.openLineupSlot);
matchesRouter.post('/:id/team-sides/:side/lineup/slots/:slotId/claim', controller.claimLineupSlot);
matchesRouter.patch(
  '/:id/team-sides/:side/lineup/slots/:slotId/position',
  controller.moveLineupSlot,
);
matchesRouter.put(
  '/:id/team-sides/:side/lineup/substitutes/:userId',
  controller.selectLineupSubstitute,
);
matchesRouter.delete(
  '/:id/team-sides/:side/lineup/substitutes/:userId',
  controller.removeLineupSubstitute,
);
matchesRouter.post(
  '/:id/team-sides/:side/lineup/selections/me/decline',
  controller.declineLineupSelection,
);
matchesRouter.post('/:id/team-sides/:side/lineup/finalize', controller.finalizeLineup);
matchesRouter.post(
  '/:id/team-sides/:side/lineup/save-as-team-default',
  controller.saveLineupAsTeamDefault,
);
matchesRouter.get('/:id/messages', controller.messages);
matchesRouter.post('/:id/messages', messageRateLimit, controller.sendMessage);
