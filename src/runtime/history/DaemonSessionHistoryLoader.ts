import type { DaemonApi } from '../daemon/api';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type SessionMessage } from '@factory/droid-sdk';

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
import { projectSessionMessages } from './projectSessionHistory';
import { readPersistedSessionMessages } from './persistedSessionMessages';
import type {
  SessionHistoryLoader,
  SessionHistoryRequest,
  SessionHistoryResult,
} from './SessionHistory';

/**
 * Daemon-mode history loader: reads a single persisted JSONL snapshot when
 * its format is recognized, otherwise uses `sessions.getMessages` (paged,
 * with `cursor` = the id of the last message of the previous page)
 * instead of spawning a droid CLI process per load (~5s fixed tax).
 * Daemon versions may return pages newest-first or oldest-first, so
 * fetched messages are normalized by their persisted creation time
 * before projection. The spawn-based loader stays as the fallback
 * for process mode and daemon failures.
 *
 * Field gaps of the daemon message read versus `loadSession()`:
 * - tokenUsage: read from the session's `.settings.json` sidecar
 *   (same cumulative totals; probe §0.7.4).
 * - mission role: derived from the sidecar's `decompSessionType`
 *   tag; the live mission STATE is not persisted there, so daemon
 *   loads report `state: null` (display-only field, rare sessions).
 * - subagentInvocations: read from the CLI's durable
 *   `~/.factory/task-invocations.json` ledger — the same data the
 *   `loadSession()` envelope carries, without a spawn. This also
 *   serves the 5s/2.5s subagent watch/panel polls.
 */
export interface DaemonFirstHistoryLoaderOptions {
  readonly getDroid: () => Promise<DaemonApi>;
  /** True while this window actually runs sessions over the daemon. */
  readonly isDaemonActive: () => boolean;
  /** Spawn-based loader used for process mode and daemon failures. */
  readonly fallback: SessionHistoryLoader;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly sessionsDirectory?: string;
  readonly taskInvocationsFile?: string;
}

/** getMessages schema cap (same daemon-side zod bound as list). */
const MESSAGES_PAGE_LIMIT = 100;
/**
 * Newest raw messages kept for projection. One more than the
 * projector's MAX_RAW_MESSAGES_TO_PROJECT so an overlong session
 * still projects as `partial`.
 */
const MAX_RAW_MESSAGE_WINDOW = 10_001;
/** Extra bounded headroom so long histories normalize in batches. */
const RAW_MESSAGE_TRIM_HEADROOM = MESSAGES_PAGE_LIMIT * 10;
/** Hard page cap against a runaway cursor loop. */
const MAX_MESSAGE_PAGES = 1_000;
/** Ledger file bound; the observed file is ~250KB. */
const MAX_TASK_INVOCATIONS_BYTES = 32 * 1024 * 1024;

export function defaultTaskInvocationsFile(): string {
  return path.join(os.homedir(), '.factory', 'task-invocations.json');
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
      let persisted = await readPersistedSessionMessages(sessionsDirectory, request.sessionId);
      let fetched = persisted === null
        ? await fetchSessionMessages(await options.getDroid(), request.sessionId)
        : { messages: orderMessagesChronologically(persisted.messages).slice(-MAX_RAW_MESSAGE_WINDOW), pages: 0 };
      const project = (messages: unknown[]) => projectSessionMessages(messages, {
        workspaceRoot: request.cwd,
        sourceSessionId: request.sessionId,
      });
      let projected = project(fetched.messages);
      if (projected.status !== 'available' && persisted !== null) {
        persisted = null;
        fetched = await fetchSessionMessages(await options.getDroid(), request.sessionId);
        projected = project(fetched.messages);
      }
      if (projected.status !== 'available') {
        throw new Error('daemon message projection unavailable');
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
          messages: fetched.messages.length,
          pages: fetched.pages,
          source: persisted === null ? 'daemon-pages' : 'persisted-snapshot',
          ...(persisted === null ? {} : { bytes: persisted.bytes }),
          items: projected.state.transcript.length,
        },
      });
      return {
        status: 'available',
        state: projected.state,
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
      return options.fallback.loadHistory(request);
    }
  };

  const loadInvocations = async (
    request: SessionHistoryRequest,
  ): Promise<readonly SubagentInvocationRecord[] | null> => {
    const fromLedger = await readTaskInvocationLedger(
      taskInvocationsFile,
      request.sessionId,
    );
    if (fromLedger !== null) {
      return fromLedger;
    }
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
    loadHistory,
    async loadSubagentSummaries(
      request: SessionHistoryRequest,
    ): Promise<readonly ToolSubagentSummary[] | null> {
      const records = await loadInvocations(request);
      return records === null ? null : records.map((entry) => entry.summary);
    },
    loadSubagentInvocations: loadInvocations,
  };
}

/**
 * Pages daemon messages and keeps a chronological rolling window of
 * the newest raw messages, mirroring the projector's own budget.
 * Ordering each bounded window handles both observed newest-first
 * daemon reads and older oldest-first behavior. Parent-chain order is
 * not used here: its disconnected-branch fallback appends old branch
 * messages after the current tip, which places stale content at the
 * transcript bottom after compaction or rewind.
 */
async function fetchSessionMessages(
  droid: DaemonApi,
  sessionId: string,
): Promise<{ readonly messages: unknown[]; readonly pages: number }> {
  const window: SessionMessage[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages < MAX_MESSAGE_PAGES) {
    const batch = await droid.sessions.getMessages(sessionId, {
      limit: MESSAGES_PAGE_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!Array.isArray(batch)) {
      throw new Error('daemon getMessages returned a non-array');
    }
    pages += 1;
    window.push(...batch);
    if (window.length > MAX_RAW_MESSAGE_WINDOW + RAW_MESSAGE_TRIM_HEADROOM) {
      const ordered = orderMessagesChronologically(window);
      window.splice(0, window.length, ...ordered.slice(-MAX_RAW_MESSAGE_WINDOW));
    }
    if (batch.length < MESSAGES_PAGE_LIMIT) {
      break;
    }
    const nextCursor = readMessageId(batch[batch.length - 1]);
    if (nextCursor === null || nextCursor === cursor) {
      break;
    }
    cursor = nextCursor;
  }
  return {
    messages: orderMessagesChronologically(window).slice(-MAX_RAW_MESSAGE_WINDOW),
    pages,
  };
}

function orderMessagesChronologically(
  messages: readonly SessionMessage[],
): SessionMessage[] {
  return messages
    .map((message, fetchedIndex) => ({ message, fetchedIndex }))
    .sort(
      (left, right) =>
        left.message.createdAt - right.message.createdAt ||
        left.fetchedIndex - right.fetchedIndex,
    )
    .map(({ message }) => message);
}

function readMessageId(value: unknown): string | null {
  if (!isStrictRecord(value) || typeof value.id !== 'string') {
    return null;
  }
  return value.id.length > 0 ? value.id : null;
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
): Promise<SessionSidecarProjection> {
  if (!isSafeSessionIdentifier(sessionId) || /[\\/]/.test(sessionId)) {
    return {};
  }
  const workspaceDirectory = await workspaceSessionsDirectory(sessionsDirectory, cwd);
  const directories =
    workspaceDirectory === sessionsDirectory
      ? [sessionsDirectory]
      : [workspaceDirectory, sessionsDirectory];
  for (const directory of directories) {
    const settings = await readBoundedSessionSettings(
      path.join(directory, `${sessionId}.settings.json`),
    );
    if (settings === null) {
      continue;
    }
    const role = settings.tags?.find(
      (tag) =>
        tag.name === 'decompSessionType' &&
        (tag.metadata?.value === 'orchestrator' || tag.metadata?.value === 'worker'),
    )?.metadata?.value as 'orchestrator' | 'worker' | undefined;
    const tokenUsage = readTokenUsageBreakdown(
      (settings as Record<string, unknown>).tokenUsage,
    );
    return {
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
      // The sidecar has no mission STATE; role alone still lets the
      // header show the decomposition identity.
      ...(role === undefined ? {} : { mission: { state: null, role } }),
    };
  }
  return {};
}

/**
 * Session-scoped view of the CLI's durable Task-invocation ledger
 * (`~/.factory/task-invocations.json`). A private-file contract with
 * precedent (`sessionFavorites.ts`): read-only, bounded, and any
 * unexpected shape reads as failure (null) so callers can fall back
 * to the authoritative spawn loader.
 */
export async function readTaskInvocationLedger(
  file: string,
  sessionId: string,
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
  const entries = parsed.invocations.filter(
    (entry): entry is Record<string, unknown> =>
      isStrictRecord(entry) && entry.parentSessionId === sessionId,
  );
  // Ledger order for FIFO pairing = dispatch order.
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
