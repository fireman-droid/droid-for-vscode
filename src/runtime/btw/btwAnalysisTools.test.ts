import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ToolConfirmationOutcome, type RequestPermissionRequestParams } from '@factory/droid-sdk/node';
import { canRunBtwAnalysisTool, type BtwAnalysisTools } from './btwAnalysisTools';
import { queryBtwGit, readBtwSnapshots } from './btwAnalysisIO';

let temp: string;
let cwd: string;
beforeEach(async () => { temp = await mkdtemp(path.join(os.tmpdir(), 'btw-analysis-')); cwd = path.join(temp, 'project'); await mkdir(cwd); });
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

describe('BTW analysis host boundary', () => {
  it('reads bounded project snapshots and rejects traversal and symlink escape', async () => {
    await writeFile(path.join(cwd, 'file.ts'), 'const x = 1;');
    await writeFile(path.join(temp, 'outside.ts'), 'outside');
    await mkdir(path.join(temp, 'outside'));
    await writeFile(path.join(temp, 'outside', 'file.ts'), 'outside');
    await symlink(path.join(temp, 'outside'), path.join(cwd, 'escape'), 'junction');
    expect(await readBtwSnapshots(cwd, ['file.ts'])).toEqual({ 'file.ts': 'const x = 1;' });
    await expect(readBtwSnapshots(cwd, ['../outside.ts'])).rejects.toThrow('inside the project');
    await expect(readBtwSnapshots(cwd, ['escape/file.ts'])).rejects.toThrow('inside the project');
    await writeFile(path.join(cwd, 'large.txt'), 'x'.repeat(65_537));
    await expect(readBtwSnapshots(cwd, ['large.txt'])).rejects.toThrow('64 KiB');
    expect(await readFile(path.join(cwd, 'file.ts'), 'utf8')).toBe('const x = 1;');
  });

  it('queries Git without changing files/index or executing configured diff/fsmonitor commands', async () => {
    git('init', '-q');
    await writeFile(path.join(cwd, 'file.ts'), 'before\n');
    git('add', 'file.ts');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
    await writeFile(path.join(cwd, 'file.ts'), 'after\n');
    await writeFile(path.join(cwd, '.gitattributes'), '*.ts diff=hostile\n');
    await writeFile(path.join(cwd, 'hostile.sh'), '#!/bin/sh\necho executed > should-not-exist\n');
    git('config', 'core.fsmonitor', './hostile.sh');
    git('config', 'diff.external', 'sh hostile.sh');
    git('config', 'diff.hostile.textconv', 'sh hostile.sh');
    const index = await readFile(path.join(cwd, '.git/index'));
    expect(await queryBtwGit(cwd, 'status')).toContain('file.ts');
    expect(await queryBtwGit(cwd, 'diff')).toContain('+after');
    expect(await queryBtwGit(cwd, 'staged_diff')).toBe('');
    expect(await queryBtwGit(cwd, 'log')).toContain('initial');
    expect(await readFile(path.join(cwd, '.git/index'))).toEqual(index);
    expect(await readFile(path.join(cwd, 'file.ts'), 'utf8')).toBe('after\n');
    await expect(readFile(path.join(cwd, 'should-not-exist'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('approves only exact owned tool requests; mixed requests and inherited tools stay denied', () => {
    const tools: BtwAnalysisTools = { mcpServers: [], toolIds: new Set(['owned___run_javascript']), cancel() {}, async close() {} };
    const request = (names: string[], allow = true) => ({
      toolUses: names.map(name => ({ toolUse: { name } })),
      options: allow ? [{ value: ToolConfirmationOutcome.ProceedOnce }] : [],
    }) as RequestPermissionRequestParams;
    expect(canRunBtwAnalysisTool(request(['owned___run_javascript']), tools)).toBe(true);
    for (const names of [[], ['Execute'], ['other___run_javascript'], ['owned___run_javascript', 'Edit']]) {
      expect(canRunBtwAnalysisTool(request(names), tools)).toBe(false);
    }
    expect(canRunBtwAnalysisTool(request(['owned___run_javascript'], false), tools)).toBe(false);
    expect(canRunBtwAnalysisTool(request(['owned___run_javascript']))).toBe(false);
  });
});
