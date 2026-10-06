import { type ModelInfo } from '@factory/droid-sdk/node';
import {
  type RuntimeCompactResult,
  type RuntimeForkResult,
  type RuntimeRewindParams,
  type RuntimeRewindResult,
} from '../DroidRuntime';
import type { RuntimeDiagnosticSink } from '../runtimeDiagnostics';
import type { FactoryDroidSession } from './sessionTypes';
import { type FactoryDroidSessionRewindParams } from './replacementTypes';
import { RewindAnchorConflictError, RewindAttachmentError } from './rewindErrors';
import { isRewindFileResult, type RewindFileResult } from '../../shared/protocol/rewindResult';
const pendingRewinds = new WeakMap<FactoryDroidSession, { messageId: string; restoreFiles: boolean }>();
export interface ReplacementContext {
  readonly session: FactoryDroidSession;
  recordDiagnostic(event: Parameters<RuntimeDiagnosticSink['record']>[0]): void;
  readonly active: boolean;
  adoptSession(
    session: FactoryDroidSession,
    models?: readonly ModelInfo[],
  ): void;
}

export async function rewind(
  context: ReplacementContext,
  params: RuntimeRewindParams,
): Promise<RuntimeRewindResult> {
  const session = context.session;
  if (context.active) {
    throw new Error('Droid runtime cannot rewind while a turn is active.');
  }
  if (typeof session.rewind !== 'function') {
    throw new Error('The Droid session does not support rewind.');
  }

  const startedAt = performance.now();
  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.rewind.started',
  });

  let nextSession: FactoryDroidSession;
  let files: RewindFileResult | undefined;
  const filesRequested = params.restoreFiles === true || pendingRewinds.get(session)?.restoreFiles === true;
  try {
    const pending = pendingRewinds.get(session);
    if (pending !== undefined && pending.messageId !== params.messageId) {
      throw new RewindAnchorConflictError(pending.messageId);
    }
    let filesToRestore: FactoryDroidSessionRewindParams['filesToRestore'] = [];
    let filesToDelete: FactoryDroidSessionRewindParams['filesToDelete'] = [];
    if (pending === undefined && params.restoreFiles === true) {
      if (typeof session.getRewindInfo !== 'function') throw new Error('Droid cannot preview file restoration for this session.');
      const info = await session.getRewindInfo({
        messageId: params.messageId,
      });
      filesToRestore = info.availableFiles;
      filesToDelete = info.createdFiles;
    }
    const outcome = await session.rewind({
      messageId: params.messageId,
      filesToRestore,
      filesToDelete,
      forkTitle: params.forkTitle,
    });
    nextSession = outcome.session;
    const { session: _session, ...result } = outcome;
    if (isRewindFileResult(result)) files = result;
    pendingRewinds.delete(session);
  } catch (error) {
    if (error instanceof RewindAttachmentError) pendingRewinds.set(session, { messageId: error.messageId, restoreFiles: filesRequested });
    context.recordDiagnostic({
      level: 'error',
      name: 'runtime.rewind.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: error instanceof RewindAttachmentError ? 'attachment-error'
          : error instanceof RewindAnchorConflictError ? 'anchor-conflict' : 'sdk-error',
      },
    });
    throw error;
  }

  // The SDK replaces the rewound session in place; re-apply captured
  // session metadata so the model catalog survives.
  context.adoptSession(nextSession, session.availableModels);

  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.rewind.finished',
    attributes: {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: 'success',
    },
  });
  return { sessionId: nextSession.id, ...(filesRequested ? { filesRequested: true } : {}),
    ...(files === undefined ? {} : { files }) };
}

export async function compact(
  context: ReplacementContext,
): Promise<RuntimeCompactResult> {
  const session = context.session;
  if (context.active) {
    throw new Error('Droid runtime cannot compact while a turn is active.');
  }
  if (typeof session.compact !== 'function') {
    throw new Error('The Droid session does not support compaction.');
  }

  const startedAt = performance.now();
  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.compact.started',
  });

  let nextSession: FactoryDroidSession;
  let removedCount: number;
  try {
    const outcome = await session.compact();
    nextSession = outcome.session;
    removedCount = Number.isSafeInteger(outcome.removedCount) ? outcome.removedCount : 0;
  } catch (error) {
    context.recordDiagnostic({
      level: 'error',
      name: 'runtime.compact.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'sdk-error',
      },
    });
    throw error;
  }

  // Compaction continues in a new session; re-apply captured session
  // metadata so the model catalog survives.
  context.adoptSession(nextSession, session.availableModels);

  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.compact.finished',
    attributes: {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: 'success',
    },
  });
  return { sessionId: nextSession.id, removedCount };
}

export async function fork(
  context: ReplacementContext,
  title: string,
): Promise<RuntimeForkResult> {
  const session = context.session;
  if (context.active) {
    throw new Error('Droid runtime cannot fork while a turn is active.');
  }
  if (typeof session.fork !== 'function') {
    throw new Error('The Droid session does not support fork.');
  }

  const startedAt = performance.now();
  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.fork.started',
  });

  let nextSession: FactoryDroidSession;
  try {
    nextSession = await session.fork({ title });
  } catch (error) {
    context.recordDiagnostic({
      level: 'error',
      name: 'runtime.fork.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'sdk-error',
      },
    });
    throw error;
  }

  // Forking replaces the SDK session handle in place; re-apply
  // captured session metadata.
  context.adoptSession(nextSession, session.availableModels);

  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.fork.finished',
    attributes: {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: 'success',
    },
  });
  return { sessionId: nextSession.id };
}

export async function rename(context: ReplacementContext, title: string): Promise<void> {
  const session = context.session;
  if (typeof session.rename !== 'function') {
    throw new Error('The Droid session does not support rename.');
  }

  const startedAt = performance.now();
  try {
    await session.rename({ title });
  } catch (error) {
    context.recordDiagnostic({
      level: 'error',
      name: 'runtime.rename.finished',
      attributes: {
        durationMs: Math.round(performance.now() - startedAt),
        outcome: 'sdk-error',
      },
    });
    throw error;
  }
  context.recordDiagnostic({
    level: 'info',
    name: 'runtime.rename.finished',
    attributes: {
      durationMs: Math.round(performance.now() - startedAt),
      outcome: 'success',
    },
  });
}
