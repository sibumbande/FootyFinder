import { ticketCheckoutSchema, ticketChoiceSchema, ticketLeaveSchema, TICKET_REFERENCE_PATTERN } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/app-error.js';
import { TicketCheckoutService } from './ticket-checkout.service.js';
import { TicketLeaveService } from './ticket-leave.service.js';
import { MyTicketsService } from './my-tickets.service.js';

const service = new TicketCheckoutService();
const leaving = new TicketLeaveService();
const mineService = new MyTicketsService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);

/** DEC-021 A1: buy a ticket for one place (a position or a substitute place). Needs an Idempotency-Key. */
export const checkout: RequestHandler = async (req, res, next) => {
  try {
    const result = await service.start(
      String(req.params.id),
      userId(res.locals),
      ticketCheckoutSchema.parse(req.body),
      String(req.get('Idempotency-Key') ?? ''),
      { ip: req.ip, userAgent: req.get('User-Agent') ?? undefined },
    );
    res.status(result.state === 'CONFIRMED' ? 201 : 202).json({ data: result });
  } catch (error) {
    next(error);
  }
};

/** DEC-021 A2: leave the match (a choice of credit or refund is needed more than 24 hours before kick-off). */
export const leave: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await leaving.leave(String(req.params.id), userId(res.locals), ticketLeaveSchema.parse(req.body ?? {}).choice) });
  } catch (error) {
    next(error);
  }
};

/** DEC-021 A3: the payer's choice for a cancelled match: a match credit or a full refund. */
export const choose: RequestHandler = async (req, res, next) => {
  try {
    const input = ticketChoiceSchema.parse(req.body);
    res.json({ data: await leaving.choose(userId(res.locals), String(req.params.id), input.choice, input.ticketIds) });
  } catch (error) {
    next(error);
  }
};

export const context: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.context(String(req.params.id), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

/** DEC-021 "Tickets & credits": upcoming and past tickets, credits with expiry, refunds and their status. */
export const mine: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await mineService.overview(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const checkoutStatus: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.status(userId(res.locals), z.string().uuid().parse(req.params.checkoutId)) });
  } catch (error) {
    next(error);
  }
};

export const checkoutStatusByReference: RequestHandler = async (req, res, next) => {
  try {
    const reference = String(req.params.reference);
    if (!TICKET_REFERENCE_PATTERN.test(reference)) throw new AppError(404, 'Checkout not found.', 'CHECKOUT_NOT_FOUND');
    res.json({ data: await service.statusByReference(userId(res.locals), reference) });
  } catch (error) {
    next(error);
  }
};
