import { createHash } from 'node:crypto';
import type { RuntimeDiagnosticAttribute, RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import { projectFrontendEvent } from './projectFrontendEvent';

/**
 * Cloudflare Worker GA4 转发地址：
 * 部署好 scripts/ga4-relay-worker.mjs 后，把你的 Worker 地址（如 'https://droid-ga4.xxx.workers.dev/collect'
 * 或绑定的自定义域名 'https://stats.example.com/collect'）填到这里，或在 VS Code 设置中配置 droidvisx.telemetry.endpoint。
 */
export const DEFAULT_GA4_RELAY_ENDPOINT = 'https://droid-ga4.k83065556.workers.dev/collect';

export type Ga4EventName =
  | 'extension_activated'
  | 'frontend_ready'
  | 'frontend_render'
  | 'frontend_error'
  | 'frontend_longtask'
  | 'activity_expand'
  | 'runtime_init'
  | 'session_history'
  | 'session_switch'
  | 'session_recovery'
  | 'daemon_health'
  | 'ide_relay'
  | 'turn_lifecycle'
  | 'context_window'
  | 'subagent_lifecycle'
  | 'tool_execution'
  | 'review_activity'
  | 'autocomplete_activity';

export interface Ga4EventPayload {
  readonly name: Ga4EventName;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface Ga4RelayBatchPayload {
  readonly client_id: string;
  readonly events: readonly Ga4EventPayload[];
}

export interface Ga4EnvironmentMetadata {
  readonly machineId: string;
  readonly sessionId: string;
  readonly extensionVersion: string;
  readonly appName: string;
  readonly platform: string;
  readonly arch: string;
  readonly language: string;
}

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SAFE_LOCALE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/u;
const SAFE_TOKEN = /^[a-zA-Z0-9._-]{1,32}$/u;
const MAX_METRIC = 86_400_000;

export function hashAnonymousClientId(machineId: string): string {
  const source = machineId.trim() || 'anonymous-machine';
  return createHash('sha256').update(`droidvisx:${source}`).digest('hex').slice(0, 32);
}

export function classifyEditorName(appName: string): 'cursor' | 'vscode' | 'other' {
  const normalized = appName.toLowerCase();
  if (normalized.includes('cursor')) return 'cursor';
  if (normalized.includes('visual studio code') || normalized === 'vscode' || normalized.includes('code - oss')) {
    return 'vscode';
  }
  return 'other';
}

function normalizePlatform(platform: string): 'win32' | 'darwin' | 'linux' | 'other' {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux' ? platform : 'other';
}

function normalizeArch(arch: string): 'x64' | 'arm64' | 'other' {
  return arch === 'x64' || arch === 'arm64' ? arch : 'other';
}

function normalizeLocale(language: string): string {
  const trimmed = language.trim().toLowerCase();
  return SAFE_LOCALE.test(trimmed) ? trimmed.slice(0, 16) : 'unknown';
}

function normalizeVersion(version: string): string {
  const trimmed = version.trim();
  return SAFE_VERSION.test(trimmed) ? trimmed.slice(0, 32) : 'unknown';
}

function safeToken(value: unknown, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 32);
  return SAFE_TOKEN.test(cleaned) ? cleaned : fallback;
}

function safeMetric(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.round(value), MAX_METRIC);
}

function engagementMs(durationMs?: number): number {
  return durationMs === undefined ? 100 : Math.max(100, Math.min(Math.round(durationMs), 60_000));
}

function addOptionalMetric(target: Record<string, string | number>, key: string, value: unknown): void {
  const metric = safeMetric(value);
  if (metric !== undefined) target[key] = metric;
}

export function classifyInitFailureReason(outcome: unknown, reason: unknown): string {
  if (outcome === 'available') return 'none';
  const text = typeof reason === 'string' ? reason : '';
  if (/Request timeout.*daemon\.load_session/iu.test(text)) return 'timeout_load_session';
  if (/Request timeout.*daemon\.create_session/iu.test(text)) return 'timeout_create_session';
  if (/timeout/iu.test(text)) return 'timeout_other';
  if (/existing session daemon is unavailable/iu.test(text)) return 'existing_daemon_unavailable';
  if (/open in another window/iu.test(text)) return 'session_in_use';
  if (/connection closed|socket|ECONNREFUSED|EPIPE|ECONNRESET/iu.test(text)) return 'connection_closed';
  if (/validation/iu.test(text)) return 'validation_failed';
  if (typeof outcome === 'string' && outcome !== 'initialization-failed') return safeToken(outcome, 'other');
  return 'other';
}

function classifyFrontendErrorSubCategory(detail: string | undefined): string {
  if (!detail) return 'unspecified';
  if (/resource failed:\s*STYLE/iu.test(detail)) return 'resource_style';
  if (/resource failed:\s*SCRIPT/iu.test(detail)) return 'resource_script';
  if (/resource failed/iu.test(detail)) return 'resource_other';
  if (/ResizeObserver/iu.test(detail)) return 'resize_observer';
  return 'runtime_error';
}

export function normalizeRelayEndpoint(raw: unknown): string | null {
  const value = (typeof raw === 'string' ? raw.trim() : '') || DEFAULT_GA4_RELAY_ENDPOINT.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Converts a host diagnostic event into a strictly sanitized GA4 event payload.
 * Never includes prompts, file paths, workspace names, raw error strings, or credentials.
 */
export function projectGa4Event(
  event: RuntimeDiagnosticEvent,
  meta: Ga4EnvironmentMetadata,
): Ga4EventPayload | undefined {
  const baseParams: Record<string, string | number> = {
    session_id: meta.sessionId,
    editor: classifyEditorName(meta.appName),
    platform: normalizePlatform(meta.platform),
    arch: normalizeArch(meta.arch),
    locale: normalizeLocale(meta.language),
    ext_version: normalizeVersion(meta.extensionVersion),
  };
  const attrs: Readonly<Record<string, RuntimeDiagnosticAttribute>> = event.attributes ?? {};

  if (event.name === 'extension.activated') {
    return {
      name: 'extension_activated',
      params: { ...baseParams, engagement_time_msec: 100 },
    };
  }

  // 1. Frontend boot / render / error / longtask / activity expand
  const renderMatch = /^(webview|sessionViewer|missionControl)\.render-ok$/u.exec(event.name);
  if (renderMatch) {
    const surface = renderMatch[1] === 'sessionViewer' ? 'viewer' : renderMatch[1] === 'missionControl' ? 'mission' : 'chat';
    const itemsMatch = /\bitems (\d+)\b/u.exec(event.detail ?? '');
    const renderMsMatch = /\brenderMs (\d+)\b/u.exec(event.detail ?? '');
    const durationMs = renderMsMatch ? safeMetric(Number(renderMsMatch[1])) : undefined;
    const records = itemsMatch ? safeMetric(Number(itemsMatch[1])) : undefined;
    if (durationMs !== undefined) {
      return {
        name: 'frontend_render',
        params: {
          ...baseParams,
          surface,
          duration_ms: durationMs,
          ...(records === undefined ? {} : { records }),
          engagement_time_msec: engagementMs(durationMs),
        },
      };
    }
  }

  if (event.name === 'host.bridge.protocol-mismatch' || event.name === 'host.bridge.rejected') {
    return {
      name: 'frontend_error',
      params: {
        ...baseParams,
        surface: 'chat',
        category: event.name === 'host.bridge.protocol-mismatch' ? 'protocol-mismatch' : 'bridge-rejected',
        sub_category: 'bridge',
        engagement_time_msec: 100,
      },
    };
  }

  const frontend = projectFrontendEvent(event);
  if (frontend) {
    switch (frontend.name) {
      case 'frontend.ready':
        return {
          name: 'frontend_ready',
          params: {
            ...baseParams,
            surface: frontend.attributes.surface,
            duration_ms: frontend.attributes.durationMs,
            engagement_time_msec: engagementMs(frontend.attributes.durationMs),
          },
        };
      case 'frontend.error':
        return {
          name: 'frontend_error',
          params: {
            ...baseParams,
            surface: frontend.attributes.surface,
            category: frontend.attributes.category,
            sub_category: classifyFrontendErrorSubCategory(event.detail),
            engagement_time_msec: 100,
          },
        };
      case 'frontend.longtask':
        return {
          name: 'frontend_longtask',
          params: {
            ...baseParams,
            surface: frontend.attributes.surface,
            task_count: frontend.attributes.count,
            total_ms: frontend.attributes.totalMs,
            max_ms: frontend.attributes.maxMs,
            engagement_time_msec: engagementMs(frontend.attributes.totalMs),
          },
        };
      case 'activity.expand':
        return {
          name: 'activity_expand',
          params: {
            ...baseParams,
            surface: frontend.attributes.surface,
            duration_ms: frontend.attributes.durationMs,
            records: frontend.attributes.records,
            engagement_time_msec: engagementMs(frontend.attributes.durationMs),
          },
        };
    }
  }

  // 2. Runtime initialization ("对话转不回来" root-cause detector)
  if (event.name === 'runtime.initialize.finished') {
    const durationMs = safeMetric(attrs.durationMs);
    const params: Record<string, string | number> = {
      ...baseParams,
      outcome: safeToken(attrs.outcome),
      failure_kind: classifyInitFailureReason(attrs.outcome, attrs.reason),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    return { name: 'runtime_init', params };
  }

  // 3. Session history loading (captures .jsonl file size KB, message count, read/project latency)
  if (event.name === 'runtime.history.daemon' || event.name === 'runtime.history.spawn' || event.name === 'runtime.history.finished') {
    const durationMs = safeMetric(attrs.durationMs);
    const bytes = typeof attrs.bytes === 'number' && Number.isFinite(attrs.bytes) && attrs.bytes >= 0
      ? Math.round(attrs.bytes / 1024)
      : undefined;
    const params: Record<string, string | number> = {
      ...baseParams,
      source: event.name === 'runtime.history.spawn'
        ? 'cli-spawn'
        : event.name === 'runtime.history.finished'
          ? safeToken(attrs.historyStatus, 'finished')
          : safeToken(attrs.source, 'daemon'),
      outcome: safeToken(attrs.outcome),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'read_ms', attrs.readMs);
    addOptionalMetric(params, 'project_ms', attrs.projectMs);
    addOptionalMetric(params, 'file_kb', bytes);
    addOptionalMetric(params, 'messages', attrs.messages);
    addOptionalMetric(params, 'records', attrs.items);
    return { name: 'session_history', params };
  }

  // 4. Session switch & activation stage timings
  if (event.name === 'host.perf.session-switch' || event.name === 'host.perf.activation-ready' || event.name === 'host.perf.history-visible') {
    const stage = event.name === 'host.perf.history-visible'
      ? 'history_visible'
      : event.name === 'host.perf.activation-ready'
        ? 'activation_ready'
        : 'switch_complete';
    const durationMs = safeMetric(attrs.durationMs);
    const params: Record<string, string | number> = {
      ...baseParams,
      stage,
      target_kind: safeToken(attrs.kind, 'resume'),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'init_ms', attrs.initializeMs);
    addOptionalMetric(params, 'history_ms', attrs.historyMs);
    addOptionalMetric(params, 'context_ms', attrs.contextMs);
    addOptionalMetric(params, 'records', attrs.items);
    return { name: 'session_switch', params };
  }

  // 5. Session recovery & UI diagnostics
  if (
    event.name === 'host.connection.auto-recovery-started' ||
    event.name === 'host.connection.auto-recovery-failed' ||
    event.name === 'host.ui.diagnostic' ||
    event.name === 'host.reload.turn-recovered' ||
    event.name === 'host.recovery.checkpoint-failed' ||
    event.name === 'host.recovery.metadata-write-failed'
  ) {
    const category = event.name === 'host.connection.auto-recovery-started'
      ? 'auto_recovery_started'
      : event.name === 'host.connection.auto-recovery-failed'
        ? 'auto_recovery_failed'
        : event.name === 'host.ui.diagnostic'
          ? 'ui_diagnostic'
          : event.name === 'host.reload.turn-recovered'
            ? 'turn_recovered'
            : event.name === 'host.recovery.checkpoint-failed'
              ? 'checkpoint_failed'
              : 'metadata_write_failed';
    return {
      name: 'session_recovery',
      params: {
        ...baseParams,
        category,
        code: safeToken(attrs.code ?? attrs.outcome, 'none'),
        engagement_time_msec: 100,
      },
    };
  }

  // 6. Daemon pool & discovery health
  if (
    event.name === 'daemon.discovery.finished' ||
    event.name === 'daemon.discovery.identity-unavailable' ||
    event.name === 'daemon.discovery.stale-record' ||
    event.name === 'daemon.sidecar.warmed' ||
    event.name === 'daemon.sidecar.warm-failed' ||
    event.name === 'daemon.sidecar.start-failed' ||
    event.name === 'daemon.sidecar.reconnecting'
  ) {
    const durationMs = safeMetric(attrs.durationMs);
    const params: Record<string, string | number> = {
      ...baseParams,
      category: safeToken(event.name.replace(/^daemon\./u, '')),
      reason: safeToken(attrs.reason ?? attrs.status, 'ok'),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'records', attrs.records ?? attrs.attempt);
    addOptionalMetric(params, 'connected_count', attrs.connected);
    return { name: 'daemon_health', params };
  }

  // 7. Native IDE relay channel
  if (
    event.name === 'ide.native.relay-state' ||
    event.name === 'ide.native.relay-restored' ||
    event.name === 'ide.native.relay-restore-failed' ||
    event.name === 'ide.native.unavailable' ||
    event.name === 'ide.native.reconnect-failed'
  ) {
    const durationMs = safeMetric(attrs.durationMs);
    const status = event.name === 'ide.native.relay-state'
      ? safeToken(attrs.status)
      : safeToken(event.name.replace(/^ide\.native\./u, ''));
    const params: Record<string, string | number> = {
      ...baseParams,
      status,
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    return { name: 'ide_relay', params };
  }

  // 8. Turn lifecycle, stream errors, stop watchdog, and turn I/O
  if (
    event.name === 'runtime.turn.finished' ||
    event.name === 'runtime.stream.error' ||
    event.name === 'host.turn.watchdog-stop-unconfirmed' ||
    event.name === 'host.turn.watchdog-settled' ||
    event.name === 'host.perf.turn-io'
  ) {
    const durationMs = safeMetric(attrs.durationMs);
    const category = event.name === 'runtime.turn.finished'
      ? 'turn_finished'
      : event.name === 'runtime.stream.error'
        ? 'stream_error'
        : event.name === 'host.turn.watchdog-stop-unconfirmed'
          ? 'stop_unconfirmed'
          : event.name === 'host.turn.watchdog-settled'
            ? 'watchdog_settled'
            : 'turn_io';
    const bytesOut = typeof attrs.bytesOut === 'number' && Number.isFinite(attrs.bytesOut) && attrs.bytesOut >= 0
      ? Math.round(attrs.bytesOut / 1024)
      : undefined;
    const params: Record<string, string | number> = {
      ...baseParams,
      category,
      outcome: safeToken(attrs.outcome ?? attrs.status, 'ok'),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'records', attrs.projectedEventCount ?? attrs.messagesOut);
    addOptionalMetric(params, 'tool_count', attrs.toolStartCount);
    addOptionalMetric(params, 'file_kb', bytesOut);
    return { name: 'turn_lifecycle', params };
  }

  // 9. Context window & session replacements (compact / rewind / fork)
  if (
    event.name === 'runtime.context.finished' ||
    event.name === 'runtime.compact.finished' ||
    event.name === 'runtime.rewind.finished' ||
    event.name === 'runtime.fork.finished'
  ) {
    const durationMs = safeMetric(attrs.durationMs);
    const category = event.name === 'runtime.context.finished'
      ? 'context_read'
      : event.name === 'runtime.compact.finished'
        ? 'compact'
        : event.name === 'runtime.rewind.finished'
          ? 'rewind'
          : 'fork';
    const params: Record<string, string | number> = {
      ...baseParams,
      category,
      outcome: safeToken(attrs.outcome, 'ok'),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'used_tokens', attrs.used);
    addOptionalMetric(params, 'limit_tokens', attrs.limit);
    return { name: 'context_window', params };
  }

  // 10. Subagent lifecycle & zombie watch
  if (
    event.name === 'runtime.subagent.started' ||
    event.name === 'host.subagent.zombie-watch' ||
    event.name === 'host.subagent.zombie-watch-settled' ||
    event.name === 'host.subagent.parent-resync'
  ) {
    const category = event.name === 'runtime.subagent.started'
      ? 'started'
      : event.name === 'host.subagent.zombie-watch'
        ? 'zombie_watch'
        : event.name === 'host.subagent.zombie-watch-settled'
          ? 'zombie_settled'
          : 'parent_resync';
    return {
      name: 'subagent_lifecycle',
      params: {
        ...baseParams,
        category,
        subagent_type: safeToken(attrs.subagentType, 'general'),
        outcome: safeToken(attrs.outcome, 'ok'),
        engagement_time_msec: 100,
      },
    };
  }

  // 11. Tool execution & permission cancellations
  if (event.name === 'runtime.tool.finished' || event.name === 'runtime.permission.auto-cancelled') {
    return {
      name: 'tool_execution',
      params: {
        ...baseParams,
        category: event.name === 'runtime.tool.finished' ? 'tool_finished' : 'permission_cancelled',
        tool_name: safeToken(attrs.tool ?? attrs.interaction, 'unknown'),
        is_error: attrs.isError === true ? 1 : 0,
        reason: safeToken(attrs.reason, 'none'),
        engagement_time_msec: 100,
      },
    };
  }

  // 12. Code review & git snapshot activity
  if (
    event.name === 'host.review.scope' ||
    event.name === 'host.changes.snapshot.diff' ||
    event.name === 'host.changes.snapshot-failed' ||
    event.name === 'review.question.start.failed' ||
    event.name === 'host.inline-diff.read-failed' ||
    event.name === 'host.file-diff.open-failed'
  ) {
    const category = event.name === 'host.review.scope'
      ? 'review_scope'
      : event.name === 'host.changes.snapshot.diff'
        ? 'snapshot_diff'
        : event.name === 'host.changes.snapshot-failed'
          ? 'snapshot_failed'
          : event.name === 'review.question.start.failed'
            ? 'question_failed'
            : event.name === 'host.inline-diff.read-failed'
              ? 'inline_diff_failed'
              : 'file_diff_failed';
    const params: Record<string, string | number> = {
      ...baseParams,
      category,
      source: safeToken(attrs.fileSource ?? attrs.lifecycle ?? attrs.stage, 'default'),
      engagement_time_msec: 100,
    };
    addOptionalMetric(params, 'records', attrs.fileCount);
    return { name: 'review_activity', params };
  }

  // 13. Autocomplete & Next Edit
  if (
    event.name === 'autocomplete.result' ||
    event.name === 'autocomplete.next-edit.result' ||
    event.name === 'autocomplete.accepted' ||
    event.name === 'autocomplete.next-edit.accepted' ||
    event.name === 'autocomplete.failed' ||
    event.name === 'autocomplete.cancelled' ||
    event.name === 'autocomplete.context.timeout'
  ) {
    const durationMs = safeMetric(attrs.durationMs);
    const category = event.name === 'autocomplete.result'
      ? 'fim_result'
      : event.name === 'autocomplete.next-edit.result'
        ? 'next_edit_result'
        : event.name === 'autocomplete.accepted'
          ? 'fim_accepted'
          : event.name === 'autocomplete.next-edit.accepted'
            ? 'next_edit_accepted'
            : event.name === 'autocomplete.failed'
              ? 'failed'
              : event.name === 'autocomplete.cancelled'
                ? 'cancelled'
                : 'context_timeout';
    const params: Record<string, string | number> = {
      ...baseParams,
      category,
      outcome: safeToken(attrs.outcome ?? attrs.code, 'ok'),
      phase: safeToken(attrs.phase, 'none'),
      reason: safeToken(attrs.reason ?? attrs.source, 'none'),
      engagement_time_msec: engagementMs(durationMs),
    };
    addOptionalMetric(params, 'duration_ms', durationMs);
    addOptionalMetric(params, 'context_ms', attrs.contextMs);
    addOptionalMetric(params, 'network_ms', attrs.networkMs);
    addOptionalMetric(params, 'records', attrs.insertionCharacters ?? attrs.characters ?? attrs.receivedCharacters);
    addOptionalMetric(params, 'status_code', attrs.status);
    return { name: 'autocomplete_activity', params };
  }

  return undefined;
}
