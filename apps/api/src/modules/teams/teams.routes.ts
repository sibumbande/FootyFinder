import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import { AppError } from '../../errors/app-error.js';
import { requireAuth } from '../../middleware/require-auth.js';
import * as controller from './teams.controller.js';
import { TEAM_IMAGE_MAX_BYTES } from './team-image.storage.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TEAM_IMAGE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, done) =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)
      ? done(null, true)
      : done(new AppError(400, 'Upload a PNG, JPEG, or WEBP image.', 'TEAM_IMAGE_INVALID')),
});

export const teamsRouter: ExpressRouter = Router();
teamsRouter.get('/', controller.list);
teamsRouter.post('/', controller.create);
teamsRouter.get('/:teamId', controller.get);
teamsRouter.patch('/:teamId', controller.update);
teamsRouter.delete('/:teamId', controller.remove);
teamsRouter.post('/:teamId/image', upload.single('image'), controller.uploadImage);
teamsRouter.get('/:teamId/members', controller.members);
teamsRouter.patch('/:teamId/members/:userId', controller.updateMemberRole);
teamsRouter.delete('/:teamId/members/:userId', controller.removeMember);
teamsRouter.post('/:teamId/invites', controller.createInvite);
teamsRouter.get('/:teamId/invites', controller.listInvites);
teamsRouter.delete('/:teamId/invites/:inviteId', controller.revokeInvite);
teamsRouter.get('/:teamId/formations/:format', controller.getFormation);
teamsRouter.put('/:teamId/formations/:format', controller.saveFormation);
teamsRouter.patch('/:teamId/formations/:format/slots/:slotId', controller.updateFormationSlot);

export const teamInvitesRouter: ExpressRouter = Router();
teamInvitesRouter.get('/:token', controller.inspectInvite);
teamInvitesRouter.post('/:token/accept', requireAuth, controller.acceptInvite);
