import { createHash } from 'node:crypto';
import { operationUndoUnavailable } from '../../shared/protocol/operationUndo';
import { readOperationBody, type OperationBody, type OperationBodyRequest } from '../../runtime/tools/operationBody';
import {
  hasOperationTextChanges,
  isWorkspaceOperationFile,
  type OperationDiff,
  type OperationDiffFile,
  type ToolExecutionPhase,
} from '../../shared/protocol/operationDiff';
import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import { readUndoFile } from './operationUndoFiles';
import {
  digest,
  type ActiveScope,
  type PersistedScope,
  type ScopeFile,
} from './reviewCoordinatorSupport';

export interface RecordedOperation {
  readonly sequence: number;
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly operationDiff: OperationDiff;
  readonly executionPhase?: ToolExecutionPhase;
}

export interface OperationRestoreEntry {
  readonly path: string;
  readonly before: Buffer | null;
  readonly after: Buffer | null;
  readonly current: Buffer | null;
  readonly status: 'restorable' | 'conflicted' | 'unsupported' | 'undone';
  readonly reason?: string;
  readonly identity?: string;
  readonly operationKeys?: readonly string[];
}

const MAX_OPERATION_RESTORE_BYTES = 16 * 1024 * 1024;

export function loadOperationReviewScope(
  message: ReviewOpenMessage,
  operations: readonly RecordedOperation[],
  persisted: ReadonlyMap<string, PersistedScope>,
  notices: readonly string[] = [],
  undoneOperations: ReadonlySet<string> = new Set(),
): ActiveScope {
  const recordedOperations = flattenOperations(operations);
  const baseline = digest([message.sessionId, 'operations', message.turnId!]);
  const operationUndoBlocked = notices.length > 0 ? notices.join(' ').slice(0, 2_000) :
    operations.some(({ operationDiff }) => operationDiff.status === 'unavailable' && operationDiff.reason !== 'unchanged')
      ? 'Some operation evidence is unavailable. Automatic undo is blocked.' : undefined;
  const reviewScopeId = digest([
    message.sessionId,
    'operations',
    message.turnId!,
    baseline,
  ]).slice(0, 24);
  const saved = persisted.get(reviewScopeId);
  const reviewed = new Map(
    saved?.baseline === baseline
      ? saved.reviewed.map(({ path, version }) => [path, version])
      : [],
  );
  const paths = [...new Set(recordedOperations.map(({ path }) => path))];
  const files: ScopeFile[] = paths.map((path) => {
    const matching = recordedOperations.filter((entry) => entry.path === path);
    const version = recordedOperationVersion(matching);
    const pending = matching.filter(entry => !undoneOperations.has(operationUndoKey(entry)));
    const undone = matching.some(entry => entry.outcome === 'applied') && pending.every(entry => entry.outcome === 'failed');
    const undoReason = undone ? 'These recorded operations have already been undone.' :
      operationUndoBlocked ?? operationPathEligibility(pending);
    return {
      path,
      additions: null,
      deletions: null,
      version,
      comparable: matching.some((entry) => entry.source === 'tool-result' && entry.outcome === 'applied' &&
        (entry.bodyRef !== undefined || entry.submittedContent !== undefined || hasOperationTextChanges(entry.patch))),
      restorable: undoReason === undefined,
      restoreConflict: false,
      ...(undoReason === undefined ? {} : { undoReason }),
      ...(undone ? { undone: true as const } : {}),
    };
  });
  const savedIndex =
    saved?.baseline === baseline && saved.currentPath !== undefined
      ? files.findIndex(({ path }) => path === saved.currentPath)
      : -1;
  const firstUnreviewed = files.findIndex(({ path }) => !reviewed.has(path));
  return {
    reviewScopeId,
    sessionId: message.sessionId,
    scopeKind: 'operations',
    turnId: message.turnId,
    baseline,
    baselineLabel: 'Recorded edits from this turn',
    lifecycle: files.length === 0 ? 'unavailable' : 'settled',
    files,
    currentIndex:
      files.length === 0
        ? null
        : savedIndex >= 0
          ? savedIndex
          : firstUnreviewed >= 0
            ? firstUnreviewed
            : 0,
    reviewed,
    recordedOperations,
    undoneOperations,
    ...(operationUndoBlocked === undefined ? {} : { operationUndoBlocked, message: operationUndoBlocked }),
    ...(files.length === 0
      ? { message: 'No attributed file operations were recorded for this turn.' }
      : {}),
  };
}

export async function preflightOperationRestore(
  root: string,
  scope: ActiveScope,
  paths: readonly string[],
  readBody: (request: OperationBodyRequest) => Promise<OperationBody | undefined> = readOperationBody,
): Promise<readonly OperationRestoreEntry[]> {
  const entries: OperationRestoreEntry[] = [];
  for (const path of paths) {
    let matching = scope.recordedOperations?.filter((entry) => entry.path === path &&
      !scope.undoneOperations?.has(operationUndoKey(entry))) ?? [];
    if (scope.files.find(file => file.path === path)?.undone) {
      entries.push({ path, before: null, current: null, after: null, status: 'undone',
        reason: 'These recorded operations have already been undone.' });
      continue;
    }
    let reason = scope.operationUndoBlocked ?? operationPathEligibility(matching);
    if (reason === undefined) {
      try {
        const hydrated: typeof matching = [];
        for (const entry of matching) {
          if (entry.outcome !== 'applied' || !entry.bodyRef || entry.kind !== 'modified') { hydrated.push(entry); continue; }
          const body = await readBody({ workspace: root, sourceSessionId: entry.sessionId,
            callId: entry.callId ?? entry.toolUseId, file: entry });
          if (!body) throw new Error('The recorded patch could not be read from its source session.');
          hydrated.push({ ...entry, ...body });
        }
        matching = hydrated;
      } catch (error) { reason = error instanceof Error ? error.message : 'The recorded patch is unavailable.'; }
    }
    let identity: string | undefined;
    let current: Buffer | null | undefined;
    try {
      const file = await readUndoFile(root, path);
      current = file.bytes;
      identity = file.identity;
    } catch (error) {
      current = undefined;
      reason = error instanceof Error ? error.message : 'The current file is unavailable.';
    }
    if (
      reason !== undefined ||
      current === undefined ||
      current !== null && current.length > MAX_OPERATION_RESTORE_BYTES
    ) {
      entries.push({
        path,
        before: current ?? null,
        after: null,
        current: current ?? null,
        status: 'unsupported',
        reason: reason ?? 'This file exceeds the automatic undo size limit.',
      });
      continue;
    }
    try {
      let planned = current;
      for (const operation of [...matching].reverse()) {
        if (operation.outcome === 'failed') continue;
        if (planned === null) throw new Error('The file no longer exists at its recorded path.');
        if (operation.kind === 'added') {
          if (createHash('sha256').update(planned).digest('hex') !== operation.createdContentHash)
            throw new Error('The created file has changed since this operation. Undo will not delete those changes.');
          planned = null;
        } else planned = Buffer.from(applyInverseUnifiedPatch(decodeUtf8(planned), operation.patch), 'utf8');
      }
      entries.push({
        path,
        before: current,
        after: planned,
        current,
        status: 'restorable',
        identity,
        operationKeys: matching.filter(entry => entry.outcome === 'applied').map(operationUndoKey),
      });
    } catch (error) {
      entries.push({
        path,
        before: current,
        after: null,
        current,
        status: error instanceof UnsupportedInversePatch ? 'unsupported' : 'conflicted',
        reason:
          error instanceof Error
            ? error.message
            : 'The inverse patch does not match the current file.',
      });
    }
  }
  return entries;
}

export function recordedOperationVersion(
  entries: NonNullable<ActiveScope['recordedOperations']>,
): string {
  return digest(entries.flatMap((entry) => [
    entry.sessionId,
    entry.toolUseId,
    String(entry.sequence),
    entry.source,
    entry.callId ?? '',
    entry.executionPhase ?? '',
    entry.path,
    entry.previousPath ?? '',
    entry.kind,
    entry.outcome ?? '',
    entry.reversible === true ? 'true' : 'false',
    entry.createdContentHash ?? '',
    entry.message ?? '',
    entry.patch,
    entry.submittedContent ?? '',
    entry.bodyRef?.digest ?? '',
    String(entry.bodyRef?.patchUnits ?? ''),
    String(entry.bodyRef?.contentUnits ?? ''),
  ]));
}

function flattenOperations(
  operations: readonly RecordedOperation[],
): NonNullable<ActiveScope['recordedOperations']> {
  return operations.flatMap((operation) => {
    const diff = operation.operationDiff;
    return diff.status !== 'ready'
      ? []
      : diff.files.filter(isWorkspaceOperationFile).map((file) => ({
          sequence: operation.sequence,
          sessionId: operation.sessionId,
          toolUseId: operation.toolUseId,
          toolName: operation.toolName,
          source: diff.source,
          callId: diff.callId,
          executionPhase: operation.executionPhase,
          ...file,
        }));
  });
}

export function operationUndoKey(entry: { sessionId: string; toolUseId: string; path: string }): string {
  return digest([entry.sessionId, entry.toolUseId, entry.path]);
}

function operationPathEligibility(
  entries: NonNullable<ActiveScope['recordedOperations']>,
): string | undefined {
  if (entries.length === 0) return 'No operation evidence was recorded.';
  if (new Set(entries.map(entry => entry.sessionId)).size > 1)
    return 'The order of operations from different sessions cannot be established safely.';
  let applied = 0;
  for (const entry of entries) {
    if (entry.source !== 'tool-result') return 'The operation was recorded only as proposed tool input.';
    if (entry.outcome === 'failed') continue;
    const reason = operationUndoUnavailable(entry);
    if (reason !== undefined) return reason;
    applied += 1;
  }
  return applied === 0 ? 'No applied operation is available to undo.' : undefined;
}

class UnsupportedInversePatch extends Error {}

function decodeUtf8(value: Buffer): string {
  if (value.includes(0)) throw new UnsupportedInversePatch('Binary files cannot be undone as text.');
  if (value.length >= 3 && value[0] === 0xef && value[1] === 0xbb && value[2] === 0xbf)
    throw new UnsupportedInversePatch('Files with a byte order mark require manual restoration.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value); }
  catch { throw new UnsupportedInversePatch('Non-UTF-8 files require manual restoration.'); }
}

interface InverseHunk {
  readonly current: readonly string[];
  readonly replacement: readonly string[];
}

export function applyInverseUnifiedPatch(currentText: string, patch: string): string {
  const hunks = parseInverseHunks(patch);
  if (currentText.includes('\r') && (/\r(?!\n)/u.test(currentText) ||
    /(?<!\r)\n/u.test(currentText))) throw new UnsupportedInversePatch('Mixed line endings require manual restoration.');
  const newline = currentText.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = currentText.endsWith('\n');
  const lines = currentText.split(/\r?\n/u);
  if (finalNewline) lines.pop();
  const matches = hunks.map((hunk) => {
    const positions = findMatches(lines, hunk.current);
    if (positions.length !== 1) {
      throw new Error(
        positions.length === 0
          ? 'The current file no longer contains the exact operation context.'
          : 'The operation context is ambiguous in the current file.',
      );
    }
    return { hunk, index: positions[0]! };
  });
  const ordered = matches.sort((left, right) => right.index - left.index);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const next = ordered[index]!;
    if (next.index + next.hunk.current.length > previous.index) {
      throw new Error('The inverse operation contains overlapping hunks.');
    }
  }
  for (const match of ordered) {
    lines.splice(
      match.index,
      match.hunk.current.length,
      ...match.hunk.replacement,
    );
  }
  return lines.join(newline) + (finalNewline ? newline : '');
}

function parseInverseHunks(patch: string): readonly InverseHunk[] {
  const lines = patch.split(/\r?\n/u);
  const hunks: InverseHunk[] = [];
  let current: string[] | null = null;
  let replacement: string[] | null = null;
  let oldCount = 0;
  let newCount = 0;
  const finish = () => {
    if (current === null || replacement === null) return;
    if (current.length !== newCount || replacement.length !== oldCount)
      throw new UnsupportedInversePatch('The operation patch is incomplete.');
    if (current.length === 0) {
      throw new UnsupportedInversePatch('An inverse hunk has no exact current-text anchor.');
    }
    hunks.push({ current, replacement });
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith('@@')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(line);
      if (!header || header.slice(1).some((number) => number !== undefined && !Number.isSafeInteger(Number(number)))) {
        throw new UnsupportedInversePatch('The operation patch does not contain absolute hunk coordinates.');
      }
      finish();
      oldCount = Number(header[2] ?? 1);
      newCount = Number(header[4] ?? 1);
      current = [];
      replacement = [];
      continue;
    }
    if (current === null || replacement === null)
      throw new UnsupportedInversePatch('The operation patch contains unsupported headers.');
    if (line.startsWith('\\ No newline at end of file')) {
      throw new UnsupportedInversePatch('The operation patch has unsupported newline-boundary metadata.');
    }
    const prefix = line[0];
    const text = line.slice(1);
    if (prefix === ' ') {
      current.push(text);
      replacement.push(text);
    } else if (prefix === '+') {
      current.push(text);
    } else if (prefix === '-') {
      replacement.push(text);
    } else if (line.length > 0 || index !== lines.length - 1) {
      throw new UnsupportedInversePatch('The operation patch contains an unsupported hunk line.');
    }
  }
  finish();
  if (hunks.length === 0) {
    throw new UnsupportedInversePatch('The operation patch contains no reversible hunks.');
  }
  return hunks;
}

function findMatches(
  lines: readonly string[],
  expected: readonly string[],
): readonly number[] {
  const matches: number[] = [];
  for (let index = 0; index + expected.length <= lines.length; index += 1) {
    if (expected.every((line, offset) => lines[index + offset] === line)) {
      matches.push(index);
    }
  }
  return matches;
}
