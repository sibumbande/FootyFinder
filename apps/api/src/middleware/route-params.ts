import type { Router } from 'express';
import type { ZodType } from 'zod';
import { uuidRouteParamSchema } from '@footy-finder/shared';
import { AppError } from '../errors/app-error.js';

export const registerRouteParam = (router: Router, name: string, schema: ZodType<string>) => {
  router.param(name, (req, _res, next, rawValue) => {
    const result = schema.safeParse(rawValue);
    if (!result.success) {
      next(
        new AppError(
          400,
          'The request contains an invalid route parameter.',
          'INVALID_ROUTE_PARAMETER',
          {
            parameter: name,
          },
        ),
      );
      return;
    }
    req.params[name] = result.data;
    next();
  });
};

export const registerUuidRouteParams = (router: Router, names: readonly string[]) => {
  names.forEach((name) => registerRouteParam(router, name, uuidRouteParamSchema));
};
