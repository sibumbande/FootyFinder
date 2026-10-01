import { fieldClosureInputSchema, fieldClosureRemovalSchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { FieldClosuresService } from './field-closures.service.js';

const service = new FieldClosuresService();
const actor = (locals: Record<string, unknown>) => String(locals.authUserId);
const requestId = (locals: Record<string, unknown>) => String(locals.requestId);

// CEO touch-up batch 3, item 3.
export const addFieldClosure: RequestHandler = async (req, res, next) => {
  try {
    res.status(201).json({ data: await service.add(String(req.params.fieldId), fieldClosureInputSchema.parse(req.body), actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const removeFieldClosure: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.remove(String(req.params.fieldId), String(req.params.closureId), fieldClosureRemovalSchema.parse(req.body).reason, actor(res.locals), requestId(res.locals)) });
  } catch (error) {
    next(error);
  }
};

export const fieldClosureClashes: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.clashes(String(req.params.fieldId)) });
  } catch (error) {
    next(error);
  }
};
