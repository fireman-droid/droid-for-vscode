import { execFile } from 'node:child_process';
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import {
  MAX_INLINE_DIFF_LINES,
  MAX_INLINE_DIFF_PATCH_LENGTH,
  type InlineDiffResult,
} from '../../shared/protocol/inlineDiffProtocol';
import type { TurnSnapshotScope, TurnSnapshotStore } from './turnSnapshots';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { describeDiffBytes } from './diffDiagnostics';

export const MAX_INLINE_DIFF_FILE_BYTES = 512 * 1024;

/** Reads only this turn's snapshot baseline, never a substitute Git baseline. */
export async function readInlineDiff(
  snapshots: TurnSnapshotStore,
  scope: TurnSnapshotScope,
  root: string,
  path: string,
  phase: 'live' | 'settled',
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): Promise<InlineDiffResult> {
  const contents = await readTurnDiffContents(snapshots, scope, root, path, phase);
  const record = snapshots.read(scope.sessionId, scope.turnId);
  diagnostics?.record({ level: 'debug', name: 'host.changes.contents',
    attributes: { ...scope, path, phase, source: 'inline', status: contents.status,
      beforeTree: record?.before ?? null, afterTree: phase === 'settled' ? record?.after ?? null : null,
      ...(contents.status === 'ready' ? describeDiffBytes(contents.before, contents.after) : {}) } });
  if (contents.status !== 'ready') return contents;
  const patch = await diffBytes(contents.before, contents.after);
  return { status: 'ready', phase, ...boundPatch(patch) };
}

export async function readTurnDiffContents(
  snapshots: TurnSnapshotStore,
  scope: TurnSnapshotScope,
  root: string,
  path: string,
  phase: 'live' | 'settled',
  maxBytes = MAX_INLINE_DIFF_FILE_BYTES,
): Promise<{ status: 'ready'; before: Buffer; after: Buffer } | Exclude<InlineDiffResult, { status: 'ready' }>> {
  const before = await snapshots.readTreeBytes(scope, path, 'before');
  if (before === undefined) return { status: 'unavailable' };
  const after = phase === 'settled'
    ? await snapshots.readTreeBytes(scope, path, 'after')
    : await readCurrentFile(root, path, maxBytes);
  if (after === undefined) return { status: 'unavailable' };
  if (after === 'too-large' ||
    (before?.length ?? 0) > maxBytes ||
    (after?.length ?? 0) > maxBytes
  ) return { status: 'too-large' };
  if (!isText(before) || !isText(after)) return { status: 'binary' };
  if (before === null && after === null) return { status: 'not-found' };
  return { status: 'ready', before: before ?? Buffer.alloc(0), after: after ?? Buffer.alloc(0) };
}

export async function readCurrentFile(root: string, path: string, maxBytes = MAX_INLINE_DIFF_FILE_BYTES): Promise<Buffer | null | undefined | 'too-large'> {
  let target: string;
  try {
    const [resolvedRoot, resolvedTarget] = await Promise.all([
      realpath(root), realpath(join(root, path)),
    ]);
    const within = relative(resolvedRoot, resolvedTarget);
    if (within === '' || within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(within)) {
      return undefined;
    }
    target = resolvedTarget;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const file = await open(target, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return undefined;
    if (stat.size > maxBytes) return 'too-large';
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (result.bytesRead === 0) break;
      size += result.bytesRead;
    }
    return size > maxBytes ? 'too-large' : bytes.subarray(0, size);
  } finally {
    await file.close();
  }
}

export function isText(bytes: Buffer | null): boolean {
  if (bytes === null) return true;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** Git provides the same line matching as native review without a new diff dependency. */
export async function diffBytes(before: Buffer, after: Buffer, context = 3): Promise<string> {
  if (before.equals(after)) return '';
  const directory = await mkdtemp(join(tmpdir(), 'droidvisx-inline-diff-'));
  try {
    await Promise.all([
      writeFile(join(directory, 'before'), before),
      writeFile(join(directory, 'after'), after),
    ]);
    const output = await new Promise<string>((resolve, reject) => {
      execFile('git', [
        '-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color',
        '--no-ext-diff', '--no-textconv', `--unified=${context}`, '--', 'before', 'after',
      ], {
        cwd: directory, encoding: 'utf8', windowsHide: true,
        timeout: 10_000, maxBuffer: 4 * 1024 * 1024,
      }, (error, stdout) => {
        // --no-index exits with 1 when it finds changes.
        if (error !== null && error.code !== 1) reject(error);
        else resolve(stdout);
      });
    });
    const hunkStart = output.search(/^@@ /m);
    if (hunkStart < 0) throw new Error('Git returned no text diff for changed bytes.');
    return output.slice(hunkStart);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function boundPatch(patch: string): { patch: string; truncated: boolean } {
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (kept.length === MAX_INLINE_DIFF_LINES || length + line.length + 1 > MAX_INLINE_DIFF_PATCH_LENGTH) break;
    kept.push(line);
    length += line.length + 1;
  }
  return { patch: kept.join('\n'), truncated: kept.length < lines.length };
}
