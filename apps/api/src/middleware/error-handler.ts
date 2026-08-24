import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
import multer from 'multer';
import { logError } from '../observability/logger.js';
import { redactedRequestPath } from './request-context.js';

type PrismaErrorResponse = {
  statusCode: number;
  error: string;
  code: string;
};

export const mapPrismaError = (error: unknown): PrismaErrorResponse | undefined => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  if (error.code === 'P2025')
    return {
      statusCode: 404,
      error: 'The requested resource was not found.',
      code: 'RESOURCE_NOT_FOUND',
    };
  if (error.code === 'P2002')
    return {
      statusCode: 409,
      error: 'That change conflicts with an existing record.',
      code: 'RESOURCE_CONFLICT',
    };
  if (['P2003', 'P2014', 'P2034'].includes(error.code))
    return {
      statusCode: 409,
      error: 'That change conflicts with the current resource state.',
      code: 'RESOURCE_CONFLICT',
    };
  return undefined;
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof multer.MulterError)
    return res.status(400).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Team images must be 5 MB or smaller.'
          : 'Invalid image upload.',
      code: 'TEAM_IMAGE_INVALID',
    });
  if (error instanceof ZodError)
    return res.status(400).json({
      error: 'Please check the submitted information.',
      code: 'VALIDATION_ERROR',
      details: error.flatten(),
    });
  if (error instanceof AppError)
    return res
      .status(error.statusCode)
      .json({ error: error.message, code: error.code, details: error.details });
  const prismaError = mapPrismaError(error);
  if (prismaError)
    return res.status(prismaError.statusCode).json({
      error: prismaError.error,
      code: prismaError.code,
    });
  logError('unhandled_http_error', error, {
    requestId: res.locals.requestId,
    method: req.method,
    path: redactedRequestPath(req.originalUrl.split('?')[0] ?? req.path),
    userId: res.locals.authUserId,
  });
  return res
    .status(500)
    .json({ error: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
};
