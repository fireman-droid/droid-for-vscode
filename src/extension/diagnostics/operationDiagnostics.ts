import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { ModelsAction } from '../../shared/protocol/modelManagerProtocol';
import type { ManagementAction } from '../../shared/protocol/managementPageProtocol';
import type { ManagementSection } from '../../shared/protocol/managementProtocol';
import type { ReviewWebviewMessage, ReviewOperationResultMessage } from '../../shared/protocol/reviewProtocol';

export type OperationOutcome = 'success' | 'failed' | 'cancelled' | 'partial' | 'accepted' | 'unknown' | 'blocked';
export type OperationFailureKind = 'cancelled' | 'timeout' | 'network' | 'authentication' | 'permission'
  | 'conflict' | 'unavailable' | 'invalid-data' | 'busy' | 'unconfirmed' | 'queue' | 'recovery' | 'unknown';
export type OperationCode = ModelsAction['kind'] | ManagementAction['kind'] | `native.${ManagementSection | 'open'}`
  | ReviewWebviewMessage['type'] | ReviewOperationResultMessage['operation']
  | 'review.readFile' | 'review.openNative' | 'review.gitStatus' | 'review.commit' | 'review.queue' | 'review.recovery' | 'review.panel';
export interface OperationResultDiagnostic {
  readonly outcome: OperationOutcome;
  readonly failureKind?: OperationFailureKind;
  readonly status?: number;
}
const OPERATIONS: ReadonlySet<string> = new Set([
  'refresh', 'cancel', 'saveConnection', 'discover', 'deleteConnection', 'renameProvider', 'renameModel',
  'saveModel', 'setModelEnabled', 'importModels', 'deleteModel', 'verifyModel', 'useModel',
  'ready', 'settings.read', 'defaults.read', 'missions.list', 'missions.new', 'chat.focus', 'account.read',
  'defaults.save', 'theme.set', 'chat.starfield.set', 'chat.busyMessageMode.set', 'language.set',
  'reviewQuestion.model.set', 'completion.save', 'sessions.list', 'session.view', 'session.export',
  'session.folder', 'session.resume', 'session.favorite', 'session.archive', 'session.rename', 'missions.open',
  'automations.list', 'automations.directory', 'automations.sessions', 'automations.visual', 'automations.target',
  'automations.session', 'automations.create', 'automations.history', 'automations.update', 'automations.run',
  'automations.pause', 'automations.resume', 'automations.delete',
  'native.open', 'native.skills', 'native.plugins', 'native.marketplaces', 'native.mcp', 'native.defaults',
  'native.terminals', 'native.updates', 'native.worktrees', 'native.archive', 'native.history-note',
  'review.listBranches', 'review.open', 'review.navigate', 'review.selectFile', 'review.markReviewed', 'review.refresh',
  'review.restorePreview', 'review.restoreFile', 'review.restoreTurn', 'review.runAgentReview',
  'open', 'mark-reviewed', 'restore-file', 'restore-turn', 'review.readFile', 'review.openNative',
  'review.gitStatus', 'review.commit', 'review.queue', 'review.recovery', 'review.panel',
] satisfies OperationCode[]);
const OUTCOMES = new Set<OperationOutcome>(['success', 'failed', 'cancelled', 'partial', 'accepted', 'unknown', 'blocked']);
const FAILURE_KINDS = new Set<OperationFailureKind>(['cancelled', 'timeout', 'network', 'authentication', 'permission',
  'conflict', 'unavailable', 'invalid-data', 'busy', 'unconfirmed', 'queue', 'recovery', 'unknown']);

/** Carries a fixed outcome separately from the private, user-facing error text. */
export class OperationOutcomeError extends Error {
  constructor(message: string, readonly diagnostic: OperationResultDiagnostic) { super(message); }
}

export function classifyOperationError(error: unknown): OperationResultDiagnostic {
  if (error instanceof OperationOutcomeError) return error.diagnostic;
  const value = error !== null && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; kind?: unknown } : {};
  if (value.name === 'AbortError' || value.code === 'ABORT_ERR') return { outcome: 'cancelled', failureKind: 'cancelled' };
  if (value.name === 'TimeoutError' || value.code === 'ETIMEDOUT' || value.code === 'UND_ERR_CONNECT_TIMEOUT' || value.kind === 'timed-out')
    return { outcome: 'failed', failureKind: 'timeout' };
  const status = typeof value.status === 'number' ? value.status : value.statusCode;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    const failureKind = status === 401 ? 'authentication' : status === 403 ? 'permission'
      : status === 408 || status === 504 ? 'timeout' : status === 409 ? 'conflict'
      : status >= 500 ? 'unavailable' : 'unknown';
    return { outcome: 'failed', failureKind, status };
  }
  if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(value.code)))
    return { outcome: 'failed', failureKind: 'network' };
  return { outcome: 'failed', failureKind: 'unknown' };
}

/** Only these scalar fields cross the projection boundary; never spread a result/error. */
export function recordOperation(
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
  surface: 'models' | 'management' | 'review',
  operation: OperationCode,
  started: number,
  result: OperationResultDiagnostic,
): void {
  try {
    if (!OPERATIONS.has(operation) || !OUTCOMES.has(result.outcome) || !['models', 'management', 'review'].includes(surface)) return;
    diagnostics?.record({
      name: 'host.operation.finished',
      level: ['failed', 'partial', 'unknown', 'blocked'].includes(result.outcome) ? 'warn' : 'info',
      attributes: { operation, surface, outcome: result.outcome,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        ...(result.failureKind !== undefined && FAILURE_KINDS.has(result.failureKind) ? { failureKind: result.failureKind } : {}),
        ...(typeof result.status === 'number' && Number.isInteger(result.status) && result.status >= 100 && result.status <= 599
          ? { status: result.status } : {}) },
    });
  } catch { /* Telemetry cannot change an operation's result or cleanup. */ }
}
