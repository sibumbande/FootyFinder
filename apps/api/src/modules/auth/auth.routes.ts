import { Router, type Router as ExpressRouter } from 'express'; import { login, logout, register } from './auth.controller.js';
export const authRouter: ExpressRouter = Router(); authRouter.post('/register', register); authRouter.post('/login', login); authRouter.post('/logout', logout);
