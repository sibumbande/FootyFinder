import type { RequestHandler, Response } from 'express'; import { loginSchema, registerSchema } from './auth.schema.js'; import { AuthService } from './auth.service.js'; import { env } from '../../config/env.js'; import { AUTH_COOKIE_NAME, TokenService } from './token.service.js';
const service = new AuthService();
const tokens = new TokenService();
const setSession = (res: Response, userId: string) => res.cookie(AUTH_COOKIE_NAME, tokens.sign(userId), { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', maxAge: env.JWT_EXPIRES_IN_SECONDS * 1000, path: '/' });
export const register: RequestHandler = async (req, res, next) => { try { const user = await service.register(registerSchema.parse(req.body)); setSession(res, user.id); res.status(201).json({ data: user }); } catch (error) { next(error); } };
export const login: RequestHandler = async (req, res, next) => { try { const user = await service.login(loginSchema.parse(req.body)); setSession(res, user.id); res.json({ data: user }); } catch (error) { next(error); } };
export const logout: RequestHandler = (_req, res) => { res.clearCookie(AUTH_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/' }); res.json({ data: { success: true } }); };
