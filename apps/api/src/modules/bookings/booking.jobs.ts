import { registerDurableJobHandler } from '../../jobs/durable-jobs.js';
import { BookingsService } from './bookings.service.js';

export const registerBookingJobHandlers = (service = new BookingsService()) => {
  registerDurableJobHandler('RESERVATION_FUNDING_EXPIRE', async (payload) => {
    const reservationId = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.reservationId : undefined;
    if (typeof reservationId !== 'string') throw Object.assign(new Error('Invalid reservation expiry payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await service.expire(reservationId);
  });
  registerDurableJobHandler('QUICK_MATCH_GUARANTEE_SETTLE', async (payload) => {
    const reservationId = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.reservationId : undefined;
    if (typeof reservationId !== 'string') throw Object.assign(new Error('Invalid Quick Match guarantee payload.'), { code: 'JOB_PAYLOAD_INVALID' });
    await service.settleQuickMatchGuarantee(reservationId);
  });
};
