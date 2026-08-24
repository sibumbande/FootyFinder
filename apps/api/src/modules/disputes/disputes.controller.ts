import { adminDisputeQuerySchema, createDisputeSchema, resolveDisputeSchema, reviewDisputeSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { DisputesService } from './disputes.service.js';

const service = new DisputesService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);
export const create: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.create(userId(res.locals), createDisputeSchema.parse(req.body)) }); } catch (error) { next(error); } };
export const listMine: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.listMine(userId(res.locals)) }); } catch (error) { next(error); } };
export const revisions: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.revisions(userId(res.locals), String(req.params.resultId)) }); } catch (error) { next(error); } };
export const listAdmin: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.listAdmin(adminDisputeQuerySchema.parse(req.query), userId(res.locals)) }); } catch (error) { next(error); } };
export const getAdmin: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.getAdmin(String(req.params.disputeId)) }); } catch (error) { next(error); } };
export const review: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.review(String(req.params.disputeId), userId(res.locals), reviewDisputeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); } };
export const resolve: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.resolve(String(req.params.disputeId), userId(res.locals), resolveDisputeSchema.parse(req.body), requestId(res.locals)) }); } catch (error) { next(error); } };
