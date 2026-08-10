import type { RequestHandler } from 'express';
import { ChatService } from '../chat/chat.service.js';
import { createMatchSchema, updateMatchSchema } from './matches.schema.js';
import { MatchesService } from './matches.service.js';

const service = new MatchesService();
const chat = new ChatService();
const userId = (locals: Record<string, unknown>) => String(locals.authUserId);
const matchId = (params: Record<string, unknown>) => String(params.id);

export const list: RequestHandler = async (_req, res, next) => { try { res.json({ data: await service.list() }); } catch (error) { next(error); } };
export const get: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.get(matchId(req.params)) }); } catch (error) { next(error); } };
export const create: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.create(createMatchSchema.parse(req.body), userId(res.locals)) }); } catch (error) { next(error); } };
export const update: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.update(matchId(req.params), updateMatchSchema.parse(req.body), userId(res.locals)) }); } catch (error) { next(error); } };
export const remove: RequestHandler = async (req, res, next) => { try { await service.remove(matchId(req.params), userId(res.locals)); res.json({ data: { success: true } }); } catch (error) { next(error); } };
export const join: RequestHandler = async (req, res, next) => { try { res.status(201).json({ data: await service.join(matchId(req.params), userId(res.locals)) }); } catch (error) { next(error); } };
export const leave: RequestHandler = async (req, res, next) => { try { await service.leave(matchId(req.params), userId(res.locals)); res.json({ data: { success: true } }); } catch (error) { next(error); } };
export const participants: RequestHandler = async (req, res, next) => { try { res.json({ data: await service.participants(matchId(req.params)) }); } catch (error) { next(error); } };
export const messages: RequestHandler = async (req, res, next) => { try { res.json({ data: await chat.history(matchId(req.params)) }); } catch (error) { next(error); } };
