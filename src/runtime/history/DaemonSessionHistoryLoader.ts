import type { DaemonApi } from '../daemon/api';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type SessionMissionSummary } from '../../shared/protocol/sessions';
import { type ToolSubagentSummary } from '../../shared/protocol/transcript';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import {
  readTokenUsageBreakdown,
  type TokenUsageBreakdown,
} from '../../shared/protocol/tokenUsage';
import {
  readBoundedSessionSettings,
  workspaceSessionsDirectory,
} from '../catalog/FactorySessionCatalog';
import { isSafeSessionIdentifier } from '../catalog/SessionCatalog';
import { defaultSessionsDirectory } from '../catalog/sessionFavorites';
import type { RuntimeDiagnosticSink } from '../runtimeDiagnostics';
import {
  readSubagentInvocationRecords,
  type SubagentInvocationRecord,
} from '../subagents/subagentSummary';
import { withSubagentInvocationSummaries } from '../subagents/subagentInvocationMatching';
import { projectSessionMessagesAsync } from './asyncHistoryProjection';
import { locatePersistedSessionFile } from './persistedSessionMessages';
import { readMissionRoleFromTags } from './sessionMission';
import type {
  SessionHistoryLoader,
  SessionHistoryRequest,
  SessionHistoryResult,
  SubagentHistoryRequest,
} from './SessionHistory';
import { unavailableSessionHistory } from './SessionHistory';

/**
 * Reads one official daemon page. Process mode has its own snapshot reader;
 * a daemon failure never silently switches to a different history source.
 *
 * Field gaps of the daemon message read versus `loadSession()`:
 * - tokenUsage: read from the session's `.settings.json` sidecar
 *   (same cumulative totals; probe §0.7.4).
 * - mission role: derived from the sidecar's official Mission tags;
 *   the live mission STATE is not persisted there, so daemon
 *   loads report `state: null` (display-only field, rare sessions).
 * - subagentInvocations: read from the CLI's durable
 *   `~/.factory/state/task-invocations.json` ledger — the same data the
 *   `loadSession()` envelope carries, without a spawn. This also
 *   serves the 5s/2.5s subagent watch/panel polls.
 */
export interface DaemonFirstHistoryLoaderOptions {
  readonly getDroid: () => Promise<DaemonApi>;
  /** True while this window actually runs sessions over the daemon. */
  readonly isDaemonActive: () => boolean;
  /** Snapshot reader used only for explicitly selected process mode. */
  readonly fallback: SessionHistoryLoader;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly sessionsDirectory?: string;
  readonly taskInvocationsFile?: string;
}

/** getMessages schema cap (same daemon-side zod bound as list). */
const MESSAGES_PAGE_LIMIT = 100;
/** Ledger file bound; the observed file is ~250KB. */
const MAX_TASK_INVOCATIONS_BYTES = 32 * 1024 * 1024;

export function defaultTaskInvocationsFile(): string {
  return path.join(os.homedir(), '.factory', 'state', 'task-invocations.json');
}

export function createDaemonFirstHistoryLoader(
  options: DaemonFirstHistoryLoaderOptions,
): SessionHistoryLoader {
  const sessionsDirectory = options.sessionsDirectory ?? defaultSessionsDirectory();
  const taskInvocationsFile = options.taskInvocationsFile ?? defaultTaskInvocationsFile();

  const record = (event: Parameters<RuntimeDiagnosticSink['record']>[0]): void => {
    try {
      options.diagnostics?.record(event);
    } catch {
      // Diagnostics must never alter history loading behavior.
    }
  };

  const loadHistory = async (
    request: SessionHistoryRequest,
  ): Promise<SessionHistoryResult> => {
    if (!options.isDaemonActive()) {
      return options.fallback.loadHistory(request);
    }
    const startedAt = performance.now();
    try {
      const fetched = await (await options.getDroid()).sessions.getMessagesPage(request.sessionId, {
        limit: request.limit ?? MESSAGES_PAGE_LIMIT,
        ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      });
      if (fetched.hasMore && (!fetched.nextCursor || fetched.nextCursor === request.cursor)) {
        throw new Error('History cursor did not advance');
      }
      // The current public endpoint returns newest first. Reverse, rather than
      // sorting equal timestamps, to preserve the daemon's stable message order.
      const messages = [...fetched.messages].reverse();
      const projected = await projectSessionMessagesAsync(messages, {
        workspaceRoot: request.cwd, sourceSessionId: request.sessionId,
      });
      if (projected.status !== 'available') {
        throw new Error('daemon message projection unavailable');
      }
      let state = projected.state;
      const parentToolUseIds = state.transcript.flatMap(item => item.kind === 'tool' && item.subagent !== undefined
        ? [item.toolUseId] : []);
      if (parentToolUseIds.length > 0) {
        // History already loaded successfully. Missing optional summaries must
        // neither discard it nor launch another CLI process to recover labels.
        const invocations = await loadLocalInvocations({ ...request, parentToolUseIds });
        if (invocations === null) record({ level: 'warn', name: 'runtime.subagents.history-summary',
          attributes: { outcome: 'ledger-unavailable', sessionId: request.sessionId, rows: parentToolUseIds.length } });
        else state = withSubagentInvocationSummaries(state, invocations);
      }
      const sidecar = await readSessionSidecar(
        sessionsDirectory,
        request.cwd,
        request.sessionId,
      );
      record({
        level: 'info',
        name: 'runtime.history.daemon',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'ok',
          sessionId: request.sessionId,
          messages: messages.length,
          pages: 1,
          source: 'daemon-page',
          items: projected.state.transcript.length,
        },
      });
      return {
        status: 'available',
        state,
        page: { messages, nextCursor: fetched.hasMore ? fetched.nextCursor! : null },
        ...(projected.messageAncestry === undefined ? {} : { messageAncestry: projected.messageAncestry }),
        ...(sidecar.mission === undefined ? {} : { mission: sidecar.mission }),
        ...(sidecar.tokenUsage === undefined ? {} : { tokenUsage: sidecar.tokenUsage }),
      };
    } catch (error) {
      record({
        level: 'warn',
        name: 'runtime.history.daemon',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'failed',
          sessionId: request.sessionId,
        },
        detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      return unavailableSessionHistory();
    }
  };

  const loadLocalInvocations = async (
    request: SubagentHistoryRequest,
  ): Promise<readonly SubagentInvocationRecord[] | null> => {
    const fromLedger = await readTaskInvocationLedger(
      taskInvocationsFile,
      request.sessionId,
      request.parentToolUseIds,
    );
    if (fromLedger === null || options.taskInvocationsFile !== undefined) return fromLedger;
    // CLI migration leaves older invocations in the previous location.
    // Current records win; never let a stale running entry replace completion.
    const legacy = await readTaskInvocationLedger(
      path.join(os.homedir(), '.factory', 'task-invocations.json'),
      request.sessionId, request.parentToolUseIds,
    );
    const currentKeys = new Set(fromLedger.map(invocationKey));
    return [...(legacy ?? []).filter((entry) => !currentKeys.has(invocationKey(entry))), ...fromLedger]
      .sort((left, right) => (left.summary.startedAt ?? 0) - (right.summary.startedAt ?? 0));
  };

  const loadInvocations = async (
    request: SubagentHistoryRequest,
  ): Promise<readonly SubagentInvocationRecord[] | null> => {
    const fromLedger = await loadLocalInvocations(request);
    if (fromLedger !== null) return fromLedger;
    record({
      level: 'warn',
      name: 'runtime.subagents.ledger',
      attributes: {
        outcome: 'failed',
        sessionId: request.sessionId,
      },
    });
    return options.fallback.loadSubagentInvocations?.(request) ?? Promise.resolve(null);
  };

  return {
    supportsPaging: options.isDaemonActive,
    loadHistory,
    async loadSubagentSummaries(
      request: SubagentHistoryRequest,
    ): Promise<readonly ToolSubagentSummary[] | null> {
      const records = await loadInvocations(request);
      return records === null ? null : records.map((entry) => entry.summary);
    },
    loadSubagentInvocations: loadInvocations,
  };
}

interface SessionSidecarProjection {
  readonly tokenUsage?: TokenUsageBreakdown;
  readonly mission?: SessionMissionSummary;
}

/**
 * Reads the session's `.settings.json` sidecar for the fields the
 * daemon message read cannot provide. Fail-soft: any miss simply
 * omits the fields.
 */
async function readSessionSidecar(
  sessionsDirectory: string,
  cwd: string,
  sessionId: string,
  persistedFile?: string,
): Promise<SessionSidecarProjection> {
  if (!isSafeSessionIdentifier(sessionId) || /[\\/]/.test(sessionId)) {
    return {};
  }
  const workspaceDirectory = await workspaceSessionsDirectory(sessionsDirectory, cwd);
  // Read metadata beside the same exact-id transcript, including Windows short
  // path slugs and previous worktrees, instead of guessing only the current cwd.
  const source = persistedFile ?? await locatePersistedSessionFile(sessionsDirectory, sessionId).catch(() => null);
  const directories = new Set([
    ...(source === null ? [] : [path.dirname(source)]),
    workspaceDirectory, sessionsDirectory,
  ]);
  for (const directory of directories) {
    const settings = await readBoundedSessionSettings(
      path.join(directory, `${sessionId}.settings.json`),
    );
    if (settings === null) {
      continue;
    }
    const role = readMissionRoleFromTags(settings.tags);
    const tokenUsage = readTokenUsageBreakdown(
      (settings as Record<string, unknown>).tokenUsage,
    );
    return {
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
      // The sidecar has no mission STATE; role alone still lets the
      // header show the decomposition identity.
      ...(role === null ? {} : { mission: { state: null, role } }),
    };
  }
  return {};
}

/**
 * Session-scoped view of the CLI's durable Task-invocation ledger
 * (`~/.factory/state/task-invocations.json`). A private-file contract with
 * precedent (`sessionFavorites.ts`): read-only, bounded, and any
 * unexpected shape reads as failure (null) so callers can fall back
 * to the authoritative spawn loader.
 */
export async function readTaskInvocationLedger(
  file: string,
  sessionId: string,
  parentToolUseIds: readonly string[] = [],
): Promise<readonly SubagentInvocationRecord[] | null> {
  let raw: string;
  try {
    const stats = await fs.stat(file);
    if (stats.size > MAX_TASK_INVOCATIONS_BYTES) {
      return null;
    }
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isStrictRecord(parsed) || !Array.isArray(parsed.invocations)) {
    return null;
  }
  const retainedCalls = new Set(parentToolUseIds);
  const entries = parsed.invocations.filter(
    (entry): entry is Record<string, unknown> =>
      isStrictRecord(entry) && (entry.parentSessionId === sessionId ||
        (typeof entry.parentToolUseId === 'string' && retainedCalls.has(entry.parentToolUseId))),
  );
  // Keep dispatch order for consumers; identity matching does not depend on it.
  entries.sort((left, right) => readTime(left) - readTime(right));
  return readSubagentInvocationRecords({
    result: { subagentInvocations: entries },
  });
}

function readTime(entry: Record<string, unknown>): number {
  return typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
    ? entry.createdAt
    : 0;
}

function invocationKey(entry: SubagentInvocationRecord): string {
  if (entry.parentToolUseId !== undefined) return `tool:${entry.parentToolUseId}`;
  if (entry.childSessionId !== null) return `child:${entry.childSessionId}`;
  return JSON.stringify([entry.summary.type, entry.summary.description, entry.summary.startedAt]);
}
