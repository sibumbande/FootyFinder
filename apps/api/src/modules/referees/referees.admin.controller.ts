import { refereeRoleChangeSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { RefereeRoleService } from './referee-role.service.js';

const roles = new RefereeRoleService();
const adminId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

export const listReferees: RequestHandler = async (_req, res, next) => {
  try { res.json({ data: await roles.list() }); } catch (error) { next(error); }
};
export const grantReferee: RequestHandler = async (req, res, next) => {
  try { res.status(201).json({ data: await roles.grant(String(req.params.userId), adminId(res.locals), refereeRoleChangeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
export const revokeReferee: RequestHandler = async (req, res, next) => {
  try { res.json({ data: await roles.revoke(String(req.params.userId), adminId(res.locals), refereeRoleChangeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); }
};
