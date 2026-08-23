import { Router, type Router as ExpressRouter } from 'express';
import * as controller from './matches.controller.js';
export const matchesRouter: ExpressRouter = Router();
matchesRouter.get('/', controller.list);
matchesRouter.post('/', controller.create);
matchesRouter.get('/invite/:token', controller.invite);
matchesRouter.get('/:id', controller.get);
matchesRouter.patch('/:id', controller.update);
matchesRouter.delete('/:id', controller.remove);
matchesRouter.post('/:id/ready', controller.ready);
matchesRouter.post('/:id/join', controller.join);
matchesRouter.get('/:id/cancellation-quote', controller.cancellationQuote);
matchesRouter.get('/:id/cancellation-status', controller.cancellationStatus);
matchesRouter.post('/:id/leave', controller.leave);
matchesRouter.patch('/:id/formation/slots/:slotId', controller.formation);
matchesRouter.patch('/:id/participants/:participantId/team', controller.changeTeam);
matchesRouter.post('/:id/result', controller.submitResult);
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
matchesRouter.post('/:id/messages', controller.sendMessage);
