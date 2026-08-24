const startedAt = new Date();
const counters = new Map<string, number>();

export const incrementOperationalMetric = (name: string, amount = 1) => {
  counters.set(name, (counters.get(name) ?? 0) + amount);
};

export const operationalMetricsSnapshot = () => ({
  startedAt,
  counters: Object.fromEntries(
    [...counters.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
});

export const resetOperationalMetricsForTests = () => counters.clear();
