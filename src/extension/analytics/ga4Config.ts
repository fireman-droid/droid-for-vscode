import { createHash } from 'node:crypto';
import type { RuntimeDiagnosticEvent } from '../../runtime/runtimeDiagnostics';
import { projectFrontendEvent } from './projectFrontendEvent';

/**
 * Cloudflare Worker GA4 转发地址：
 * 部署好 scripts/ga4-relay-worker.mjs 后，把你的 Worker 地址（如 'https://droid-ga4.xxx.workers.dev/collect'
 * 或绑定的自定义域名 'https://stats.example.com/collect'）填到这里，或在 VS Code 设置中配置 droidvisx.telemetry.endpoint。
 */
export const DEFAULT_GA4_RELAY_ENDPOINT = '';

export type Ga4EventName =
  | 'extension_activated'
  | 'frontend_ready'
  | 'frontend_error'
  | 'frontend_longtask'
  | 'activity_expand';

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
  const baseParams = {
    session_id: meta.sessionId,
    editor: classifyEditorName(meta.appName),
    platform: normalizePlatform(meta.platform),
    arch: normalizeArch(meta.arch),
    locale: normalizeLocale(meta.language),
    ext_version: normalizeVersion(meta.extensionVersion),
  };

  if (event.name === 'extension.activated') {
    return {
      name: 'extension_activated',
      params: {
        ...baseParams,
        engagement_time_msec: 100,
      },
    };
  }

  const frontend = projectFrontendEvent(event);
  if (!frontend) return undefined;

  switch (frontend.name) {
    case 'frontend.ready':
      return {
        name: 'frontend_ready',
        params: {
          ...baseParams,
          surface: frontend.attributes.surface,
          duration_ms: frontend.attributes.durationMs,
          engagement_time_msec: Math.max(100, Math.min(frontend.attributes.durationMs, 60_000)),
        },
      };
    case 'frontend.error':
      return {
        name: 'frontend_error',
        params: {
          ...baseParams,
          surface: frontend.attributes.surface,
          category: frontend.attributes.category,
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
          engagement_time_msec: Math.max(100, Math.min(frontend.attributes.totalMs, 60_000)),
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
          engagement_time_msec: Math.max(100, Math.min(frontend.attributes.durationMs, 60_000)),
        },
      };
  }
}
