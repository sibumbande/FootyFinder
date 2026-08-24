import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { createSocketServer } from './socket/create-socket-server.js';
import { startMatchLifecycleScheduler } from './modules/matches/match-lifecycle.scheduler.js';
import { startDurableJobScheduler } from './jobs/durable-jobs.js';
import { registerWalletHoldJobHandlers } from './modules/wallet/wallet-hold.jobs.js';

const server = createServer(app);
createSocketServer(server);
startMatchLifecycleScheduler();
registerWalletHoldJobHandlers();
startDurableJobScheduler();
server.listen(env.PORT, () => console.log(`API listening on http://localhost:${env.PORT}`));
