import { Router, type Router as ExpressRouter } from 'express';
import * as controller from './tickets.controller.js';

/** DEC-021: the payer's own checkouts (the Paystack return page asks these; nothing here confirms a payment). */
export const ticketsRouter: ExpressRouter = Router();
ticketsRouter.get('/checkouts/by-reference/:reference', controller.checkoutStatusByReference);
ticketsRouter.get('/checkouts/:checkoutId', controller.checkoutStatus);
