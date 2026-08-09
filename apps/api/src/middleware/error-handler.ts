import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) return res.status(400).json({ error: 'Please check the submitted information.', code: 'VALIDATION_ERROR', details: error.flatten() });
  if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message, code: error.code, details: error.details });
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
};
