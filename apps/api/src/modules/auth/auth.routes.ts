import { Router, type Router as ExpressRouter } from 'express';
import {
  confirmEmailChange,
  login,
  logout,
  register,
  requestEmailChange,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  verifyEmail,
} from './auth.controller.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
import { requireSession } from '../../middleware/require-auth.js';
export const authRouter: ExpressRouter = Router();
authRouter.post('/register', authRateLimit, register);
authRouter.post('/login', authRateLimit, login);
authRouter.post('/logout', logout);
authRouter.post('/email/verification/resend', requireSession, authRateLimit, resendVerification);
authRouter.post('/email/verify', authRateLimit, verifyEmail);
authRouter.post('/password/reset/request', authRateLimit, requestPasswordReset);
authRouter.post('/password/reset', authRateLimit, resetPassword);
authRouter.post('/email/change/request', requireSession, authRateLimit, requestEmailChange);
authRouter.post('/email/change/confirm', authRateLimit, confirmEmailChange);
