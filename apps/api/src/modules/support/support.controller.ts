import {
  createSupportTicketSchema,
  supportReplySchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { SupportService } from './support.service.js';

const service = new SupportService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
export const create: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.create(userId(res.locals), createSupportTicketSchema.parse(req.body)) }); } catch (error) { next(error); } };
export const list: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.listMine(userId(res.locals)) }); } catch (error) { next(error); } };
export const get: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.getMine(String(req.params.ticketId), userId(res.locals)) }); } catch (error) { next(error); } };
export const reply: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.replyMine(String(req.params.ticketId), userId(res.locals), supportReplySchema.parse(req.body)) }); } catch (error) { next(error); } };
