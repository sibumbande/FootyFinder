import { adminWaitingListCsvQuerySchema, adminWaitingListQuerySchema } from '@footy-finder/shared';
import type { RequestHandler } from 'express';
import { WaitingListAdminService } from './waiting-list.admin.service.js';

const service = new WaitingListAdminService();

// CEO touch-up batch 3.5, item 4.
export const listWaitingList: RequestHandler = async (req, res, next) => {
  try {
    res.json({ data: await service.list(adminWaitingListQuerySchema.parse(req.query)) });
  } catch (error) {
    next(error);
  }
};

/** Subscribed entries only, as a UTF-8 CSV (with a byte-order mark so Excel reads accents correctly). */
export const downloadWaitingListCsv: RequestHandler = async (req, res, next) => {
  try {
    const { cityId } = adminWaitingListCsvQuerySchema.parse(req.query);
    const file = await service.csv(cityId, String(res.locals.authUserId), String(res.locals.requestId));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`﻿${file.body}`);
  } catch (error) {
    next(error);
  }
};
