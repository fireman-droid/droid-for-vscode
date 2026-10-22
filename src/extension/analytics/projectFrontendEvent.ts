import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';

type Surface = 'chat' | 'viewer' | 'mission';
export type FrontendEvent =
  | { name: 'frontend.ready'; attributes: { surface: Surface; durationMs: number } }
  | { name: 'frontend.error'; attributes: { surface: Surface; category: 'error' | 'unhandledrejection' | 'boot-timeout' | 'handshake-timeout' } }
  | { name: 'frontend.longtask'; attributes: { surface: Surface; count: number; totalMs: number; maxMs: number } }
  | { name: 'activity.expand'; attributes: { surface: 'history' | 'tool' | 'thinking'; durationMs: number; records: number } };

const errorKinds = ['error', 'unhandledrejection', 'boot-timeout', 'handshake-timeout'] as const;
function metric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86_400_000;
}

/** Local statistics contain only classified events and measurements, never diagnostic prose. */
export function projectFrontendEvent(event: RuntimeDiagnosticEvent): FrontendEvent | undefined {
  const match = /^(webview|sessionViewer|missionControl)\.(.+)$/u.exec(event.name);
  if (!match) return undefined;
  const surface = match[1] === 'sessionViewer' ? 'viewer' : match[1] === 'missionControl' ? 'mission' : 'chat';
  const kind = match[2];
  if ((errorKinds as readonly string[]).includes(kind)) {
    return { name: 'frontend.error', attributes: { surface, category: kind as typeof errorKinds[number] } };
  }
  if (kind === 'boot-ok') {
    const duration = /\bbootMs (\d+)$/u.exec(event.detail ?? '');
    const durationMs = duration ? Number(duration[1]) : undefined;
    return metric(durationMs) ? { name: 'frontend.ready', attributes: { surface, durationMs } } : undefined;
  }
  if (kind !== 'perf-longtask' && kind !== 'perf-batch') return undefined;
  let detail: unknown;
  try { detail = JSON.parse(event.detail ?? ''); } catch { return undefined; }
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined;
  const sample = detail as Record<string, unknown>;
  if (kind === 'perf-longtask' && sample.source === 'chat.longtask' && metric(sample.count) &&
      metric(sample.totalMs) && metric(sample.maxMs)) {
    return { name: 'frontend.longtask', attributes: { surface, count: Math.round(sample.count),
      totalMs: Math.round(sample.totalMs), maxMs: Math.round(sample.maxMs) } };
  }
  if (kind === 'perf-batch' && sample.source === 'activity.expand' && metric(sample.durationMs) &&
      metric(sample.records) && (sample.surface === 'history' || sample.surface === 'tool' || sample.surface === 'thinking')) {
    // Event-to-paint response latency, not isolated CPU render time.
    return { name: 'activity.expand', attributes: { surface: sample.surface,
      durationMs: Math.round(sample.durationMs), records: Math.round(sample.records) } };
  }
  return undefined;
}
