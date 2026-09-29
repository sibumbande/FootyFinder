import './assert-disposable-test-database.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/database/prisma.js';
import { GO_NO_GO_JOB_TYPE } from '../src/modules/matches/go-no-go.js';
import { OperationsService } from '../src/modules/admin/operations.service.js';
import {
  incrementOperationalMetric,
  resetOperationalMetricsForTests,
} from '../src/observability/operational-metrics.js';

const service = new OperationsService();
const marker = `ops-smoke-${randomUUID()}`;

try {
  const readiness = await service.readiness();
  assert.equal(readiness.status, 'ready');
  assert.equal(readiness.database, 'ready');
  assert.ok(readiness.responseTimeMs >= 0);

  resetOperationalMetricsForTests();
  incrementOperationalMetric('operations_smoke_total');
  const summary = await service.summary();
  assert.equal(summary.database.status, 'ready');
  assert.equal(summary.processMetrics.operations_smoke_total, 1);
  assert.ok(summary.accounts.active >= 0);
  assert.ok(summary.workQueues.openDisputes >= 0);
  assert.ok(summary.durableJobs.overdue >= 0);
  assert.ok(summary.finance24Hours.succeededTransactions >= 0);

  // DEC-018 monitoring: an overdue and a FAILED T-30 go/no-go job are listed for admins.
  // runAt in the distant past so they sort ahead of any other problem rows.
  const overdueJob = await prisma.durableJob.create({
    data: {
      type: GO_NO_GO_JOB_TYPE,
      dedupeKey: `${marker}:overdue`,
      payload: { matchId: randomUUID() },
      runAt: new Date('2000-01-01T00:00:00.000Z'),
    },
  });
  const failedJob = await prisma.durableJob.create({
    data: {
      type: GO_NO_GO_JOB_TYPE,
      dedupeKey: `${marker}:failed`,
      payload: { matchId: randomUUID() },
      runAt: new Date('2000-01-01T00:00:01.000Z'),
      status: 'FAILED',
      attempts: 10,
      lastError: 'SMOKE_FAILURE',
    },
  });
  const withProblems = await service.summary();
  assert.ok(withProblems.goNoGo.overdue >= 1, 'Overdue go/no-go job not counted.');
  assert.ok(withProblems.goNoGo.failed >= 1, 'Failed go/no-go job not counted.');
  const listed = (jobId: string) => withProblems.goNoGo.items.find((item) => item.jobId === jobId);
  assert.equal(listed(overdueJob.id)?.problem, 'OVERDUE');
  assert.equal(listed(failedJob.id)?.problem, 'FAILED');
  assert.equal(listed(failedJob.id)?.lastError, 'SMOKE_FAILURE');
  console.log('Slice 9 readiness, database aggregates, go/no-go monitoring and process-metric smoke test passed.');
} finally {
  await prisma.durableJob.deleteMany({ where: { dedupeKey: { startsWith: marker } } });
  await prisma.$disconnect();
}
