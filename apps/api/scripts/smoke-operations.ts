import './assert-disposable-test-database.js';
import assert from 'node:assert/strict';
import { prisma } from '../src/database/prisma.js';
import { OperationsService } from '../src/modules/admin/operations.service.js';
import {
  incrementOperationalMetric,
  resetOperationalMetricsForTests,
} from '../src/observability/operational-metrics.js';

const service = new OperationsService();

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
  console.log('Slice 9 readiness, database aggregates, and process-metric smoke test passed.');
} finally {
  await prisma.$disconnect();
}
