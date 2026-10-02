import { ConnectionError, InvalidSessionCwdError } from '@factory/droid-sdk/node';
import { DaemonAvailabilityError } from '../daemon/daemonConnection';
import { type RuntimeSessionTarget } from '../DroidRuntime';
import type { RuntimeAvailability } from '../runtimeEvents';
import {
  sanitizeSubagentDescription,
  sanitizeSubagentType,
  readSubagentTimestamp,
} from '../subagents/subagentSummary';
import { MAX_TOOL_NAME_LENGTH } from '../../shared/protocol/bounds';
import {
  isToolExecutionPhase,
  type ToolExecutionPhase,
} from '../../shared/protocol/operationDiff';

const MAX_SESSION_ID_LENGTH = 256;

export function classifyInitializationFailure(error: unknown): {
  reason: Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'];
  message: string;
  level: 'warn' | 'error';
  diagnosticError?: unknown;
} {
  if (error instanceof Error && error.message === 'Response validation failed') {
    // Schema errors can contain response values in their cause. Report only
    // the fixed classification, without forwarding the SDK error or cause.
    return {
      reason: 'sdk-protocol-incompatible',
      message: 'The local Droid CLI returned data incompatible with the Droid SDK.',
      level: 'error',
    };
  }
  if (error instanceof DaemonAvailabilityError) {
    const [reason, message] = daemonInitializationFailure(error.reason);
    return { reason, message, level: 'error', diagnosticError: error };
  }
  if (error instanceof InvalidSessionCwdError) {
    return {
      reason: 'invalid-cwd', message: 'Droid rejected the requested working directory.', level: 'warn',
    };
  }
  if (isMissingCliError(error)) {
    return { reason: 'cli-not-found', message: 'The Droid CLI executable was not found.', level: 'warn' };
  }
  return {
    reason: 'initialization-failed',
    message: 'The Droid SDK could not initialize a session.',
    level: 'error',
    diagnosticError: error,
  };
}

export function daemonInitializationFailure(
  reason: DaemonAvailabilityError['reason'],
): [Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'], string] {
  switch (reason) {
    case 'not-logged-in':
      return [
        'daemon-not-logged-in',
        'Sign in with the droid CLI, then retry the daemon connection.',
      ];
    case 'credentials-unreadable':
      return [
        'daemon-credentials-unreadable',
        'Droid could not read the current Droid CLI sign-in.',
      ];
    case 'refresh-failed':
    case 'authentication-failed':
      return [
        'daemon-refresh-failed',
        'The Droid CLI sign-in could not authenticate the local daemon.',
      ];
    case 'connect-failed':
      return ['daemon-unavailable', 'The local droid daemon could not be reached.'];
  }
}

/** Renders an unknown value (SDK event or thrown error) for the log. */
export function describeUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function normalizeSessionTarget(
  target: RuntimeSessionTarget | string,
): RuntimeSessionTarget {
  return typeof target === 'string' ? { kind: 'new', cwd: target } : target;
}

export function sameSessionTarget(
  left: RuntimeSessionTarget,
  right: RuntimeSessionTarget | null,
): boolean {
  return (
    right !== null &&
    left.kind === right.kind &&
    left.cwd === right.cwd &&
    (left.kind === 'new'
      ? right.kind === 'new' && (left.worktree === true) === (right.worktree === true) &&
        JSON.stringify(left.systemPrompt) === JSON.stringify(right.systemPrompt)
      : right.kind === 'resume' && left.sessionId === right.sessionId && left.child === right.child)
  );
}

export function isMissingCliError(error: unknown): boolean {
  if (!(error instanceof ConnectionError)) {
    return false;
  }

  return (
    hasErrorCode(error.cause, 'ENOENT') || hasErrorCode(error.metadata?.error, 'ENOENT')
  );
}

export function hasErrorCode(error: unknown, expectedCode: string): boolean {
  return error instanceof Error && 'code' in error && error.code === expectedCode;
}

export function isSafeSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/**
 * Reads a `child_session_available` session notification into the
 * bounded fields the `subagent-started` runtime event carries. The
 * `childSessionId` in the payload is intentionally never read so it
 * cannot leave the Runtime. Returns null for any other notification.
 */
export function readSubagentStartedNotification(raw: Record<string, unknown>): {
  toolUseId: string | null;
  subagentType: string;
  description: string;
  startedAt?: number;
} | null {
  const params = raw['params'];
  if (typeof params !== 'object' || params === null) {
    return null;
  }
  const { notification } = params as Record<string, unknown>;
  if (typeof notification !== 'object' || notification === null) {
    return null;
  }
  const { type, toolUseId, subagentType, description, timestamp } = notification as Record<
    string,
    unknown
  >;
  if (type !== 'child_session_available') {
    return null;
  }
  const startedAt = readSubagentTimestamp(timestamp);
  return {
    toolUseId: isSafeSessionId(toolUseId) ? toolUseId : null,
    subagentType: sanitizeSubagentType(subagentType) ?? 'unknown',
    description: sanitizeSubagentDescription(description),
    ...(startedAt === undefined ? {} : { startedAt }),
  };
}

export function readToolExecutionPhaseNotification(
  raw: Record<string, unknown>,
  expectedSessionId: string,
): {
  toolUseId: string;
  toolName: string;
  phase: ToolExecutionPhase;
} | null {
  const params = raw.params;
  if (typeof params !== 'object' || params === null) return null;
  const envelope = params as Record<string, unknown>;
  if (
    envelope.sessionId !== undefined &&
    envelope.sessionId !== expectedSessionId
  )
    return null;
  const notification = envelope.notification;
  if (typeof notification !== 'object' || notification === null) return null;
  const record = notification as Record<string, unknown>;
  if (
    record.type !== 'tool_execution_phase_changed' ||
    (record.sessionId !== undefined &&
      record.sessionId !== expectedSessionId) ||
    !isSafeSessionId(record.toolUseId) ||
    !isToolExecutionPhase(record.phase)
  )
    return null;
  const toolName =
    typeof record.toolName === 'string'
      ? record.toolName
          .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, ' ')
          .trim()
          .slice(0, MAX_TOOL_NAME_LENGTH)
      : '';
  if (!toolName) return null;
  return {
    toolUseId: record.toolUseId,
    toolName,
    phase: record.phase,
  };
}
