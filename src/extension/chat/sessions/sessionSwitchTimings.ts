import type { RuntimeDiagnosticEvent } from '../../../runtime/runtimeDiagnostics';
import type { RuntimeSessionTarget } from '../../../runtime/DroidRuntime';

export type SessionSwitchKind = RuntimeSessionTarget['kind'];

/**
 * One session replacement's Host-clock phase measurements. History and
 * initialize run in parallel; context starts after activation.
 */
export interface SessionSwitchTimings {
  readonly kind: SessionSwitchKind;
  readonly startedAt: number;
  initializeMs: number | null;
  historyMs: number | null;
  contextMs: number | null;
  ready: boolean;
  recorded: boolean;
}

export function createSessionSwitchTimings(
  kind: SessionSwitchKind,
): SessionSwitchTimings {
  return {
    kind,
    startedAt: performance.now(),
    initializeMs: null,
    historyMs: null,
    contextMs: null,
    ready: false,
    recorded: false,
  };
}

export function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

/**
 * Returns the one terminal diagnostic once activation and context have
 * both settled. Callers own emission so diagnostics remain fail-soft.
 */
export function finishSessionSwitchTiming(
  timings: SessionSwitchTimings,
): RuntimeDiagnosticEvent | null {
  if (timings.recorded || !timings.ready || timings.contextMs === null) {
    return null;
  }
  timings.recorded = true;
  return {
    level: 'info',
    name: 'host.perf.session-switch',
    attributes: {
      kind: timings.kind,
      durationMs: elapsedMs(timings.startedAt),
      initializeMs: timings.initializeMs,
      historyMs: timings.historyMs,
      contextMs: timings.contextMs,
    },
  };
}
