import { beforeEach, describe, expect, it } from 'vitest';
import {
  incrementOperationalMetric,
  operationalMetricsSnapshot,
  resetOperationalMetricsForTests,
} from './operational-metrics.js';

describe('operational metrics', () => {
  beforeEach(() => resetOperationalMetricsForTests());

  it('accumulates named process counters without exposing mutable state', () => {
    incrementOperationalMetric('jobs_succeeded');
    incrementOperationalMetric('jobs_succeeded', 2);
    incrementOperationalMetric('jobs_failed');

    expect(operationalMetricsSnapshot().counters).toEqual({
      jobs_failed: 1,
      jobs_succeeded: 3,
    });
    expect(operationalMetricsSnapshot().startedAt).toBeInstanceOf(Date);
  });
});
