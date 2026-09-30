import {
  MAX_OPERATION_DIFF_FILES,
  MAX_OPERATION_DIFF_UNITS,
  operationDiffWithChanges,
  type OperationDiff,
  type OperationDiffFile,
} from '../../shared/protocol/operationDiff';
import { isStrictRecord } from '../../shared/validation/strictValidation';
import { toolDisplayPath } from './toolDisplayPath';
import { isRestrictedToolContent, isRestrictedToolPath, readResultSource } from './toolResultPreview';
import { applyPatchAbsolutePath, applyPatchDeclarationKey, readApplyPatchDeclarations, type ApplyPatchDeclaration } from './applyPatchDeclarations';

export type OperationTool = 'applypatch' | 'edit' | 'create' | 'write';
type UnavailableReason = Extract<
  OperationDiff,
  { status: 'unavailable' }
>['reason'];
const MAX_RESULT_SOURCE_UNITS = MAX_OPERATION_DIFF_UNITS * 4;
const MAX_DIFF_LINES = MAX_OPERATION_DIFF_UNITS;

export function parseOperationResult(
  tool: OperationTool,
  input: unknown,
  content: unknown,
  workspace: string | undefined,
  callId?: string,
  sourceSessionId?: string,
  eventIsError = false,
): OperationDiff {
  if (!workspace) return unavailable('not-recorded');
  const text = readResultText(content);
  if (text === 'too-large') return unavailable('too-large');
  if (text === undefined) return unavailable(eventIsError ? 'failed' : 'not-recorded');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return unavailable(eventIsError ? 'failed' : 'not-recorded');
  }
  const patchInput = tool === 'applypatch' ? readPatchInput(input) : undefined;
  const patchDeclarations = patchInput === undefined ? undefined : readApplyPatchDeclarations(patchInput, workspace);
  const declared = tool === 'applypatch' ? patchDeclarations?.flatMap(({ file }) => file ? [file] : []) ?? null
    : readDeclaredFiles(tool, input, workspace);
  if (declared === null) return unavailable('unattributed');
  const parsed =
    tool === 'edit'
      ? parseEditResult(value, declared, workspace)
      : tool === 'applypatch'
        ? parseApplyPatchResult(value, patchDeclarations!, workspace)
        : parseCreateResult(value, declared, workspace, input);
  if (typeof parsed === 'string') return unavailable(parsed);
  const files = parsed.map((file) => {
    if (!eventIsError || file.outcome !== 'applied') return redactOperationFile(file, workspace);
    const { submittedContent: _submittedContent, ...metadata } = file;
    return redactOperationFile({
      ...metadata,
      outcome: 'uncertain',
      reversible: false,
      message: 'The SDK marked this tool result as failed.',
    }, workspace);
  });
  if (!files.length) return unavailable(eventIsError ? 'failed' : 'not-recorded');
  if (
    files.length > MAX_OPERATION_DIFF_FILES ||
    files.reduce((total, file) => total + file.patch.length + (file.submittedContent?.length ?? 0), 0) >
      MAX_OPERATION_DIFF_UNITS
  )
    return unavailable('too-large');
  return operationDiffWithChanges({
    status: 'ready',
    source: 'tool-result',
    ...safeIdentity(callId, sourceSessionId),
    files,
  });
}

/** A restricted file must not hide unrelated files from the same tool operation. */
export function redactOperationFile(file: OperationDiffFile, workspace: string): OperationDiffFile {
  const restrictedPath = (path: string) => {
    if (file.scope === 'mission') return isRestrictedToolPath(path);
    const source = readResultSource('Read', { file_path: path }, workspace, 'operation');
    return typeof source === 'string' || source.scope !== undefined;
  };
  if (!restrictedPath(file.path) &&
    (!file.previousPath || !restrictedPath(file.previousPath)) &&
    !isRestrictedToolContent(file.patch) &&
    (file.submittedContent === undefined || !isRestrictedToolContent(file.submittedContent)) &&
    (file.message === undefined || !isRestrictedToolContent(file.message))) return file;
  const { submittedContent: _submittedContent, ...metadata } = file;
  return {
    ...metadata,
    patch: '',
    contentRestricted: true,
    reversible: false,
    message: 'This file’s content is restricted. Automatic undo is unavailable.',
  };
}

export function readDeclaredFiles(
  tool: OperationTool,
  rawInput: unknown,
  workspace: string,
): OperationDiffFile[] | null {
  const input =
    tool === 'applypatch' && typeof rawInput === 'string'
      ? { input: rawInput }
      : rawInput;
  if (!isStrictRecord(input)) return null;
  if (tool === 'applypatch') {
    if (typeof input.input !== 'string') return null;
    return readApplyPatchDeclarations(input.input, workspace)?.flatMap(({ file }) => file ? [file] : []) ?? null;
  }
  const rawPath = input.file_path ?? input.filePath ?? input.path;
  const location =
    typeof rawPath === 'string'
      ? toolDisplayPath(workspace, rawPath)
      : undefined;
  if (!location) return null;
  if (tool === 'edit') {
    if (
      typeof input.old_str !== 'string' ||
      input.old_str.length === 0 ||
      typeof input.new_str !== 'string'
    )
      return null;
    return [
      {
        ...location,
        ...(location.scope === 'mission' ? { reversible: false } : {}),
        kind: 'modified',
        patch: replacementPatch(input.old_str, input.new_str),
        ...(input.change_all === true || input.replace_all === true
          ? { message: 'Proposed replacement applies to every matching occurrence.' } : {}),
      },
    ];
  }
  const source = input.content ?? input.file_text ?? input.text;
  if (typeof source !== 'string') return null;
  return [{ ...location, ...(location.scope === 'mission' ? { reversible: false } : {}), kind: 'added', patch: addedContentPatch(source) }];
}

function parseEditResult(
  value: unknown,
  declared: readonly OperationDiffFile[],
  workspace: string,
): OperationDiffFile[] | UnavailableReason {
  if (
    !isStrictRecord(value) ||
    value.success !== true ||
    typeof value.file_path !== 'string' ||
    !Array.isArray(value.diffLines) ||
    value.diffLines.length > MAX_DIFF_LINES ||
    !isNonNegativeInteger(value.linesAdded) ||
    !isNonNegativeInteger(value.linesRemoved)
  )
    return 'not-recorded';
  const additions = value.diffLines.filter(
    (line) => isStrictRecord(line) && line.type === 'added',
  ).length;
  const removals = value.diffLines.filter(
    (line) => isStrictRecord(line) && line.type === 'removed',
  ).length;
  if (additions !== value.linesAdded || removals !== value.linesRemoved)
    return 'not-recorded';
  const location = toolDisplayPath(workspace, value.file_path);
  if (!location || declared.length !== 1 || location.path !== declared[0]!.path || location.scope !== declared[0]!.scope)
    return 'unattributed';
  if (value.diffLines.length === 0 && additions === 0 && removals === 0) return 'unchanged';
  const patch = editDiffLinesPatch(value.diffLines);
  if (patch === undefined) return 'not-recorded';
  return [{ ...location, kind: 'modified', patch, outcome: 'applied', reversible: false }];
}

function parseApplyPatchResult(
  value: unknown,
  declared: readonly ApplyPatchDeclaration[],
  workspace: string,
): OperationDiffFile[] | UnavailableReason {
  if (!isStrictRecord(value) || value.success !== true || !Array.isArray(value.files)) return 'not-recorded';
  if (value.files.length > MAX_OPERATION_DIFF_FILES) return 'too-large';
  const remaining = new Map(
    declared.map((file) => [applyPatchDeclarationKey(file.originalPath, file.path), file] as const),
  );
  const files: OperationDiffFile[] = [];
  for (const raw of value.files) {
    if (
      !isStrictRecord(raw) ||
      typeof raw.file_path !== 'string' ||
      !['create', 'update', 'delete'].includes(String(raw.display_operation))
    )
      return 'not-recorded';
    const original = applyPatchAbsolutePath(workspace, raw.file_path);
    const movedTo =
      raw.moved_to === undefined
        ? undefined
        : typeof raw.moved_to === 'string'
          ? applyPatchAbsolutePath(workspace, raw.moved_to)
          : undefined;
    if (!original || (raw.moved_to !== undefined && !movedTo))
      return 'restricted';
    const identity = applyPatchDeclarationKey(original, movedTo);
    const declaration = remaining.get(identity);
    if (!declaration) return 'unattributed';
    remaining.delete(identity);
    if (raw.error !== undefined && (typeof raw.error !== 'string' || raw.error.trim().length === 0))
      return 'not-recorded';
    const error = readErrorMessage(raw.error);
    const kind = movedTo ? 'renamed' : raw.display_operation === 'create' ? 'added'
      : raw.display_operation === 'delete' ? 'deleted' : 'modified';
    if (error === undefined && !(
      declaration.kind === 'added' && (kind === 'added' || kind === 'modified') ||
      declaration.kind === kind
    )) return 'unattributed';
    const expected = declaration.file;
    // Match every returned identity, but keep external files out of Review and Undo.
    if (expected === undefined) continue;
    if (error !== undefined) {
      files.push({
        path: expected.path,
        ...(expected.scope === undefined ? {} : { scope: expected.scope }),
        ...(expected.previousPath ? { previousPath: expected.previousPath } : {}),
        kind,
        patch: '',
        outcome: movedTo ? 'uncertain' : 'failed',
        message: error,
        reversible: false,
      });
      continue;
    }
    let patch = '';
    let reversible = false;
    let message: string | undefined;
    if (raw.display_operation === 'update') {
      if (typeof raw.diff !== 'string') return 'not-recorded';
      const normalized = normalizeUnifiedPatch(raw.diff);
      if (normalized === undefined) return 'not-recorded';
      patch = normalized.patch;
      reversible = normalized.complete && movedTo === undefined;
      if (!normalized.complete) message =
        'The tool reported this file as changed, but its diff line counts are inconsistent. ' +
        'Showing the recorded lines; the diff may be incomplete and automatic undo is unavailable.';
    } else if (raw.display_operation === 'create') {
      if (typeof raw.content !== 'string') return 'not-recorded';
      patch = addedContentPatch(raw.content);
    }
    files.push({
      path: expected.path,
      ...(expected.scope === undefined ? {} : { scope: expected.scope }),
      ...(expected.previousPath ? { previousPath: expected.previousPath } : {}),
      kind,
      patch,
      outcome: 'applied',
      reversible: expected.scope === 'mission' ? false : reversible,
      ...(message === undefined ? {} : { message }),
    });
  }
  for (const declaration of remaining.values()) {
    const missing = declaration.file;
    if (missing === undefined) continue;
    files.push({
      ...missing,
      patch: '',
      outcome: 'uncertain',
      message: 'The tool result did not report an outcome for this file.',
      reversible: false,
    });
  }
  return files;
}

function parseCreateResult(
  value: unknown,
  declared: readonly OperationDiffFile[],
  workspace: string,
  input: unknown,
): OperationDiffFile[] | UnavailableReason {
  if (
    !isStrictRecord(value) ||
    value.success !== true ||
    typeof value.file_path !== 'string'
  )
    return 'not-recorded';
  const location = toolDisplayPath(workspace, value.file_path);
  if (!location || declared.length !== 1 || location.path !== declared[0]!.path || location.scope !== declared[0]!.scope)
    return 'unattributed';
  if (!isStrictRecord(input)) return 'unattributed';
  const content = input.content ?? input.file_text ?? input.text;
  if (typeof content !== 'string') return 'not-recorded';
  const submittedContent = content.replace(/\r\n?/gu, '\n');
  if (submittedContent.length > MAX_OPERATION_DIFF_UNITS) return 'too-large';
  return [{ ...location, kind: 'added', patch: '', submittedContent, outcome: 'applied', reversible: false }];
}

function readPatchInput(input: unknown): string | undefined {
  return typeof input === 'string' ? input
    : isStrictRecord(input) && typeof input.input === 'string' ? input.input : undefined;
}

function editDiffLinesPatch(lines: readonly unknown[]): string | undefined {
  type Entry = {
    type: 'added' | 'removed' | 'unchanged';
    content: string;
    old?: number;
    next?: number;
  };
  const parsed: Entry[] = [];
  for (const raw of lines) {
    if (
      !isStrictRecord(raw) ||
      !['added', 'removed', 'unchanged'].includes(String(raw.type)) ||
      typeof raw.content !== 'string' ||
      raw.content.includes('\n')
    )
      return undefined;
    const numbers = raw.lineNumber;
    if (numbers === undefined) {
      // Droid inserts display-only "... N unchanged lines ..." entries
      // without coordinates. They separate hunks and are never content.
      if (raw.type !== 'unchanged') return undefined;
      parsed.push({ type: 'unchanged', content: '', old: 0, next: 0 });
      continue;
    }
    if (!isStrictRecord(numbers)) return undefined;
    const old = readLineNumber(numbers.old);
    const next = readLineNumber(numbers.new);
    if (
      (numbers.old !== undefined && old === undefined) ||
      (numbers.new !== undefined && next === undefined) ||
      (raw.type === 'added' && next === undefined) ||
      (raw.type === 'removed' && old === undefined) ||
      (raw.type === 'added' && old !== undefined) ||
      (raw.type === 'removed' && next !== undefined) ||
      (raw.type === 'unchanged' && (old === undefined || next === undefined))
    )
      return undefined;
    parsed.push({
      type: raw.type as Entry['type'],
      content: raw.content.replace(/\r$/u, ''),
      ...(old === undefined ? {} : { old }),
      ...(next === undefined ? {} : { next }),
    });
  }
  const groups: Entry[][] = [];
  let group: Entry[] = [];
  for (const entry of parsed) {
    if (entry.old === 0 && entry.next === 0) {
      if (group.length) groups.push(group);
      group = [];
      continue;
    }
    const previous = group[group.length - 1];
    if (previous && !isContinuous(previous, entry)) {
      groups.push(group);
      group = [];
    }
    group.push(entry);
  }
  if (group.length) groups.push(group);
  if (!groups.length) return undefined;
  const hunks: string[] = [];
  for (const entries of groups) {
    const oldCount = entries.filter((entry) => entry.type !== 'added').length;
    const newCount = entries.filter((entry) => entry.type !== 'removed').length;
    const firstOldIndex = entries.findIndex((entry) => entry.old !== undefined);
    const firstNewIndex = entries.findIndex((entry) => entry.next !== undefined);
    const oldStart =
      firstOldIndex < 0
        ? Math.max(0, entries[firstNewIndex]!.next! - 1)
        : entries[firstOldIndex]!.old! -
          entries.slice(0, firstOldIndex).filter((entry) => entry.type !== 'added')
            .length;
    const newStart =
      firstNewIndex < 0
        ? Math.max(0, entries[firstOldIndex]!.old! - 1)
        : entries[firstNewIndex]!.next! -
          entries.slice(0, firstNewIndex).filter((entry) => entry.type !== 'removed')
            .length;
    if (oldStart < 0 || newStart < 0) return undefined;
    hunks.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...entries.map(
        (entry) =>
          `${entry.type === 'added' ? '+' : entry.type === 'removed' ? '-' : ' '}${entry.content}`,
      ),
    );
  }
  const patch = hunks.join('\n');
  return patch.length <= MAX_OPERATION_DIFF_UNITS ? patch : undefined;
}

function isContinuous(
  previous: { type: string; old?: number; next?: number },
  current: { old?: number; next?: number },
): boolean {
  const expectedOld =
    previous.old === undefined
      ? undefined
      : previous.old + (previous.type === 'added' ? 0 : 1);
  const expectedNew =
    previous.next === undefined
      ? undefined
      : previous.next + (previous.type === 'removed' ? 0 : 1);
  return (
    (current.old === undefined ||
      expectedOld === undefined ||
      current.old === expectedOld) &&
    (current.next === undefined ||
      expectedNew === undefined ||
      current.next === expectedNew)
  );
}

function normalizeUnifiedPatch(source: string): { patch: string; complete: boolean } | undefined {
  if (source.length > MAX_OPERATION_DIFF_UNITS) return undefined;
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const hunks: string[] = [];
  let complete = true;
  let index = 0;
  while (index < lines.length && !lines[index]!.startsWith('@@')) index += 1;
  while (index < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(
      lines[index]!,
    );
    if (!header) return undefined;
    const oldExpected = Number(header[2] ?? 1);
    const newExpected = Number(header[4] ?? 1);
    let oldCount = 0;
    let newCount = 0;
    hunks.push(lines[index]!);
    index += 1;
    while (index < lines.length && !lines[index]!.startsWith('@@')) {
      const line = lines[index]!;
      if (line === '' && index === lines.length - 1) {
        index += 1;
        break;
      }
      if (line.startsWith('\\ No newline at end of file')) {
        hunks.push(line);
      } else if (line.startsWith(' ')) {
        oldCount += 1;
        newCount += 1;
        hunks.push(line);
      } else if (line.startsWith('-')) {
        oldCount += 1;
        hunks.push(line);
      } else if (line.startsWith('+')) {
        newCount += 1;
        hunks.push(line);
      } else {
        return undefined;
      }
      index += 1;
    }
    // A result can contain useful recorded changes without being safe to undo.
    // Keep every reported hunk verbatim; do not invent missing lines or counts.
    if (oldCount !== oldExpected || newCount !== newExpected) complete = false;
  }
  const patch = hunks.join('\n');
  return hunks.length > 0 && patch.length <= MAX_OPERATION_DIFF_UNITS
    ? { patch, complete }
    : undefined;
}

function replacementPatch(before: string, after: string): string {
  return [
    '@@',
    ...before.replace(/\r\n?/gu, '\n').split('\n').map((line) => `-${line}`),
    ...after.replace(/\r\n?/gu, '\n').split('\n').map((line) => `+${line}`),
  ].join('\n');
}

function addedContentPatch(content: string): string {
  const normalized = content.replace(/\r\n?/gu, '\n');
  const lines = normalized.length === 0 ? [] : normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`),
    ...(normalized.length > 0 && !normalized.endsWith('\n') ? ['\\ No newline at end of file'] : [])].join(
    '\n',
  );
}

function readResultText(content: unknown): string | 'too-large' | undefined {
  let text: string;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    const blocks: string[] = [];
    for (const block of content) {
      if (!isStrictRecord(block) || block.type !== 'text' || typeof block.text !== 'string')
        return undefined;
      blocks.push(block.text);
    }
    text = blocks.join('\n');
  } else return undefined;
  return text.length > MAX_RESULT_SOURCE_UNITS ? 'too-large' : text.trim();
}

function readLineNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function readErrorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const message = value
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu, '')
    .trim();
  return message.slice(0, 2_000);
}

function safeIdentity(callId?: string, sourceSessionId?: string) {
  const safe = (value: string | undefined): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  return {
    ...(safe(callId) ? { callId } : {}),
    ...(safe(sourceSessionId) ? { sourceSessionId } : {}),
  };
}

function unavailable(
  reason: Extract<OperationDiff, { status: 'unavailable' }>['reason'],
): OperationDiff {
  return { status: 'unavailable', reason };
}
