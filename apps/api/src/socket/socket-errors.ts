import { AppError } from '../errors/app-error.js';

export interface PublicSocketError {
  code: string;
  message: string;
}

export const publicSocketError = (
  error: unknown,
  fallback: PublicSocketError,
): PublicSocketError => {
  if (error instanceof AppError)
    return {
      code: error.code ?? 'REQUEST_REJECTED',
      message: error.message,
    };
  return fallback;
};
