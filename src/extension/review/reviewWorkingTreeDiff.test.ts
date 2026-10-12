import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { createActiveScope } from './reviewCoordinatorSupport';
import { readReviewPatch } from './reviewContent';
import { loadReviewGitScope, reviewGit } from './reviewGitComparison';

vi.mock('vscode', () => ({}));

const execute = promisify(execFile);
let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('shows only text edits in Uncommitted counts and patches when working files use CRLF', async () => {
  root = await mkdtemp(join(tmpdir(), 'dvx-review-crlf-'));
  await execute('git', ['-c', 'core.autocrlf=false', 'clone', '--no-hardlinks', '--quiet', process.cwd(), root], { windowsHide: true });
  const before = (await reviewGit(root, ['show', 'HEAD:README.md'])).toString('utf8');
  const changed = Buffer.from(before.replace(/^[^\n]*/, '# Changed heading').replace(/\r?\n/g, '\r\n'));
  const endingsOnly = Buffer.from((await reviewGit(root, ['show', 'HEAD:package.json'])).toString('utf8').replace(/\r?\n/g, '\r\n'));
  await writeFile(join(root, 'README.md'), changed);
  await writeFile(join(root, 'package.json'), endingsOnly);
  const indexBefore = await reviewGit(root, ['write-tree']);
  for (const kind of ['workspace', 'unstaged'] as const) {
    const result = await loadReviewGitScope(root, kind);
    expect(result.files.find(file => file.path === 'README.md')).toMatchObject({ additions: 1, deletions: 1 });
    expect(result.files.some(file => file.path === 'package.json')).toBe(false);
    const scope = createActiveScope({ type: 'review.open', sessionId: 'fixture', scopeKind: kind },
      result.baseline, result.label, result.files, new Map());
    scope.comparison = result.comparison;
    const source = { snapshots: {} as TurnSnapshotStore, getWorkspaceRoot: () => root };
    for (const context of [3, 'all'] as const) {
      const { patch } = await readReviewPatch(source, scope, 'README.md', context);
      const lines = patch.split('\n');
      expect(lines.filter(line => line.startsWith('+'))).toEqual(['+# Changed heading\r']);
      expect(lines.filter(line => line.startsWith('-'))).toEqual([`-${before.split('\n')[0]}`]);
    }
  }
  expect(await reviewGit(root, ['write-tree'])).toEqual(indexBefore);
  expect(await readFile(join(root, 'README.md'))).toEqual(changed);
  expect(await readFile(join(root, 'package.json'))).toEqual(endingsOnly);
}, 30_000);
