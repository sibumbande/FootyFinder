import {
  teamContributionRefundSchema,
  teamContributionSchema,
  teamWalletHistoryQuerySchema,
} from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { TeamWalletService } from './team-wallet.service.js';

const service = new TeamWalletService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const teamId = (params: Record<string, unknown>) => String(params.teamId);
const idempotencyKey = (header: string | undefined) => String(header ?? '');

export const summary: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.summary(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const transactions: RequestHandler = async (req, res, next) => {
  try {
    res.json({
      data: await service.history(teamId(req.params), userId(res.locals), teamWalletHistoryQuerySchema.parse(req.query)),
    });
  } catch (error) {
    next(error);
  }
};
export const holds: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.holds(teamId(req.params), userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
export const contribute: RequestHandler = async (req, res, next) => {
  try {
    const { amountCents } = teamContributionSchema.parse(req.body);
    const result = await service.contribute(teamId(req.params), userId(res.locals), amountCents, idempotencyKey(req.header('Idempotency-Key')));
    res.status(result.replayed ? 200 : 201).json({ data: result });
  } catch (error) {
    next(error);
  }
};
export const refund: RequestHandler = async (req, res, next) => {
  try {
    const { amountCents } = teamContributionRefundSchema.parse(req.body);
    const result = await service.refund(teamId(req.params), userId(res.locals), amountCents, idempotencyKey(req.header('Idempotency-Key')));
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};
export const reclaimable: RequestHandler = async (_req, res, next) => {
  try {
    res.json({ data: await service.reclaimable(userId(res.locals)) });
  } catch (error) {
    next(error);
  }
};
