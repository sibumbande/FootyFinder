/**
 * TKT-505 formation interaction instrumentation (DEC-013 budget).
 *
 * - `pointer-to-render`: input event to the committed render of its local feedback (drag movement
 *   or an optimistic tap/drop). Budget: under 100 ms.
 * - `drop-to-confirm`: optimistic change to the server settling it (success or rejection). Budget:
 *   two seconds at p95.
 *
 * Samples live in a small in-memory ring buffer. Nothing is sent anywhere. Outside production
 * builds the buffer is also exposed on `window.__footyFormationTimings` so browser tests and
 * manual profiling can read real measurements.
 */
export type FormationTimingKind = 'pointer-to-render' | 'drop-to-confirm';

export interface FormationTimingSample {
  kind: FormationTimingKind;
  durationMs: number;
  outcome?: 'success' | 'error';
  at: number;
}

export const FORMATION_TIMING_BUDGET_MS: Record<FormationTimingKind, number> = {
  'pointer-to-render': 100,
  'drop-to-confirm': 2_000,
};

const MAX_SAMPLES = 200;
const samples: FormationTimingSample[] = [];

export const formationNow = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export function recordFormationTiming(
  kind: FormationTimingKind,
  durationMs: number,
  outcome?: FormationTimingSample['outcome'],
) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;
  samples.push({ kind, durationMs, outcome, at: formationNow() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export const formationTimingSamples = (kind?: FormationTimingKind) =>
  samples.filter((sample) => !kind || sample.kind === kind);

export const resetFormationTimings = () => {
  samples.length = 0;
};

const percentile = (sorted: number[], fraction: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] : 0;

export function summarizeFormationTimings(kind: FormationTimingKind) {
  const durations = formationTimingSamples(kind)
    .map(({ durationMs }) => durationMs)
    .sort((left, right) => left - right);
  const p95 = percentile(durations, 0.95);
  return {
    count: durations.length,
    p50: percentile(durations, 0.5),
    p95,
    max: durations.at(-1) ?? 0,
    withinBudget: p95 <= FORMATION_TIMING_BUDGET_MS[kind],
  };
}

declare global {
  interface Window {
    __footyFormationTimings?: {
      samples: typeof formationTimingSamples;
      summary: typeof summarizeFormationTimings;
      reset: typeof resetFormationTimings;
    };
  }
}

if (typeof window !== 'undefined' && import.meta.env.MODE !== 'production')
  window.__footyFormationTimings = {
    samples: formationTimingSamples,
    summary: summarizeFormationTimings,
    reset: resetFormationTimings,
  };
