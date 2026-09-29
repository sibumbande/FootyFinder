import type { RequestHandler } from 'express';
import { BookingsService } from './bookings.service.js';

const service = new BookingsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
export const list: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.listMine(userId(res.locals)) }); } catch (error) { next(error); } };
export const get: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.get(String(req.params.bookingId), userId(res.locals)) }); } catch (error) { next(error); } };
