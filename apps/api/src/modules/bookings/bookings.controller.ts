import { bookingContributionSchema, playerFieldBookingSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { BookingsService } from './bookings.service.js';

const service = new BookingsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
export const fields: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.listBookableFields() }); } catch (error) { next(error); } };
export const list: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.listMine(userId(res.locals)) }); } catch (error) { next(error); } };
export const create: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.createPlayer(playerFieldBookingSchema.parse(req.body), userId(res.locals)) }); } catch (error) { next(error); } };
export const get: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.get(String(req.params.bookingId), userId(res.locals)) }); } catch (error) { next(error); } };
export const contribute: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.contribute(String(req.params.bookingId), userId(res.locals), bookingContributionSchema.parse(req.body), String(req.header('Idempotency-Key') ?? '')) }); } catch (error) { next(error); } };
