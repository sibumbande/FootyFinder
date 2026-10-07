import { createServer } from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { createSocketServer } from './socket/create-socket-server.js';
import { startMatchLifecycleScheduler } from './modules/matches/match-lifecycle.scheduler.js';
import { startDurableJobScheduler } from './jobs/durable-jobs.js';
import { registerRetiredJobHandlers } from './jobs/retired-jobs.js';
import { registerModerationJobHandlers } from './modules/moderation/moderation.jobs.js';
import { registerGoNoGoJobHandlers } from './modules/matches/go-no-go.jobs.js';
import { registerMatchCancelledEmailJobHandlers } from './modules/matches/match-cancelled-email.jobs.js';
import { registerFillReminderJobHandlers } from './modules/matches/fill-reminder.jobs.js';
import { registerPaystackWebhookJobHandlers } from './modules/payments/paystack-webhook.jobs.js';
import { checkPayfastItnReachable, registerPayfastItnJobHandlers } from './modules/payments/payfast-itn.js';
import { logInfo } from './observability/logger.js';
import { registerTeamMatchJobHandlers } from './modules/team-matches/team-match.jobs.js';
import { registerRefereeJobHandlers } from './modules/referees/referee.jobs.js';
import { registerAccountDeletionJobHandlers } from './modules/account/account-deletion.jobs.js';
import { registerRetentionJobHandlers, scheduleRetention } from './modules/retention/retention.jobs.js';
import { registerTicketJobHandlers, scheduleMatchCreditExpiry } from './modules/tickets/ticket.jobs.js';

const server = createServer(app);
createSocketServer(server);
startMatchLifecycleScheduler();
registerRetiredJobHandlers();
registerModerationJobHandlers();
registerGoNoGoJobHandlers();
registerMatchCancelledEmailJobHandlers();
registerFillReminderJobHandlers();
registerPaystackWebhookJobHandlers();
registerPayfastItnJobHandlers();
registerTeamMatchJobHandlers();
registerRefereeJobHandlers();
registerAccountDeletionJobHandlers();
registerRetentionJobHandlers();
registerTicketJobHandlers();
void scheduleMatchCreditExpiry().catch((error) => console.error('match_credit_expiry_schedule_failed', error));
void scheduleRetention().catch((error) => console.error('retention_schedule_failed', error));
startDurableJobScheduler();
server.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
  // PayFast confirms payments only through its ITN: say straight away if PayFast could not reach it.
  if (env.PAYMENT_PROVIDER === 'payfast')
    void checkPayfastItnReachable(env.PUBLIC_API_URL).then(
      (check) =>
        check.ok
          ? logInfo('payfast_itn_reachable', { url: check.url })
          : console.error(JSON.stringify({ level: 'error', event: 'payfast_itn_unreachable', url: check.url, problem: `PayFast cannot reach ${check.url}, so no PayFast payment can be confirmed: ${check.detail}` })),
    );
});
