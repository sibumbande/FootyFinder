import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { createSocketServer } from './socket/create-socket-server.js';
import { startMatchLifecycleScheduler } from './modules/matches/match-lifecycle.scheduler.js';
import { startDurableJobScheduler } from './jobs/durable-jobs.js';
import { registerWalletHoldJobHandlers } from './modules/wallet/wallet-hold.jobs.js';
import { registerBookingJobHandlers } from './modules/bookings/booking.jobs.js';
import { registerModerationJobHandlers } from './modules/moderation/moderation.jobs.js';

const server = createServer(app);
createSocketServer(server);
startMatchLifecycleScheduler();
registerWalletHoldJobHandlers();
registerBookingJobHandlers();
registerModerationJobHandlers();
startDurableJobScheduler();
server.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
