import { Router, type Router as ExpressRouter } from 'express';
import { login, logout, register } from './auth.controller.js';
import { authRateLimit } from '../../middleware/rate-limit.js';
export const authRouter: ExpressRouter = Router();
authRouter.post('/register', authRateLimit, register);
authRouter.post('/login', authRateLimit, login);
authRouter.post('/logout', logout);
