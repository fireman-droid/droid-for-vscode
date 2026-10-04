import { resolve } from 'node:path';
import { MAX_OPERATION_BODY_UNITS, MAX_OPERATION_DIFF_FILES, type OperationDiffFile } from '../../shared/protocol/operationDiff';
import { toolDisplayPath } from './toolDisplayPath';

/** Absolute identities stay inside Runtime; only file may cross the display boundary. */
export interface ApplyPatchDeclaration {
  readonly originalPath: string;
  readonly path: string;
  readonly kind: OperationDiffFile['kind'];
  readonly file?: OperationDiffFile;
}

export function applyPatchAbsolutePath(workspace: string, raw: string): string | undefined {
  if (!raw || raw.length > 4_096 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(raw)) return undefined;
  return resolve(workspace, raw);
}

export function applyPatchDeclarationKey(originalPath: string, path = originalPath): string {
  const key = `${originalPath}\u0000${path}`;
  return process.platform === 'win32' ? key.toLowerCase() : key;
}

export function readApplyPatchDeclarations(source: string, workspace: string): ApplyPatchDeclaration[] | null {
  if (source.length > MAX_OPERATION_BODY_UNITS * 4) return null;
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.shift() !== '*** Begin Patch') return null;
  const declarations: ApplyPatchDeclaration[] = [];
  let current: { originalPath: string; path: string; kind: OperationDiffFile['kind']; patch: string[] } | undefined;
  const finish = (): void => {
    if (!current) return;
    const original = toolDisplayPath(workspace, current.originalPath);
    const location = toolDisplayPath(workspace, current.path);
    const file: OperationDiffFile | undefined = original && location && original.scope === location.scope ? {
      ...location,
      ...(location.scope === 'mission' ? { reversible: false } : {}),
      ...(current.path === current.originalPath ? {} : { previousPath: original.path }),
      kind: current.kind,
      patch: current.patch.join('\n'),
    } : undefined;
    declarations.push({
      originalPath: current.originalPath,
      path: current.path,
      kind: current.kind,
      ...(file === undefined ? {} : { file }),
    });
  };
  let ended = false;
  for (const line of lines) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/u.exec(line);
    if (header) {
      finish();
      const path = applyPatchAbsolutePath(workspace, header[2]!);
      if (path === undefined) return null;
      current = {
        originalPath: path,
        path,
        kind: header[1] === 'Add' ? 'added' : header[1] === 'Delete' ? 'deleted' : 'modified',
        patch: ['@@'],
      };
    } else if (line.startsWith('*** Move to: ') && current) {
      const path = applyPatchAbsolutePath(workspace, line.slice(13));
      if (path === undefined) return null;
      current.path = path;
      current.kind = 'renamed';
    } else if (line === '*** End Patch') {
      finish();
      current = undefined;
      ended = true;
      break;
    } else if (current && line.startsWith('@@')) {
      if (current.patch.length > 1) current.patch.push('@@');
    } else if (current && /^[ +\-]/u.test(line)) {
      current.patch.push(line);
    } else if (line !== '' && line !== '*** End of File') {
      return null;
    }
  }
  const identities = new Set(declarations.map(({ originalPath, path }) => applyPatchDeclarationKey(originalPath, path)));
  return ended && declarations.length > 0 && declarations.length <= MAX_OPERATION_DIFF_FILES &&
    identities.size === declarations.length ? declarations : null;
}
