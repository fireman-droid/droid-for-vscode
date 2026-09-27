import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FactorySessionCatalog } from './FactorySessionCatalog';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dvx-resume-selection-'));
  roots.push(root);
  const cwd = path.join(root, 'workspace');
  const directory = path.join(root, 'sessions');
  const stored = path.join(directory, '-legacy-workspace');
  await Promise.all([mkdir(cwd), mkdir(stored, { recursive: true })]);
  const listSdkSessions = vi.fn(async () => []);
  const catalog = new FactorySessionCatalog({ sessionsDirectory: directory, listSdkSessions });
  const header = { type: 'session_start', id: 'selected', title: 'Mission', version: 2, cwd };
  const writeHeader = (value: unknown) => writeFile(path.join(stored, 'selected.jsonl'),
    JSON.stringify(value) + '\n' + 'body must not be read for workspace verification\n'.repeat(2_000));
  return { root, cwd, stored, catalog, header, writeHeader, listSdkSessions };
}

describe('selected session workspace verification', () => {
  it.each([2, 3])('verifies a bounded session_start header in a version %s log', async version => {
    const { cwd, catalog, header, writeHeader, listSdkSessions } = await fixture();
    await writeHeader({ ...header, version });
    await expect(catalog.canResumeSession(cwd, 'selected')).resolves.toBe(true);
    expect(listSdkSessions).not.toHaveBeenCalled();
  });

  it('compares physical directories when the persisted path uses an alias', async () => {
    const { root, cwd, catalog, header, writeHeader } = await fixture();
    const alias = path.join(root, 'alias');
    await symlink(cwd, alias, 'junction');
    await writeHeader(header);
    await expect(catalog.canResumeSession(alias, 'selected')).resolves.toBe(true);
  });

  it.each([
    { id: 'different-id' }, { cwd: undefined }, { cwd: 'relative-path' },
    { decompSessionType: 'worker' }, { callingSessionId: 'parent' }, { callingToolUseId: 'tool' },
    { type: 'message' }, { title: 'x'.repeat(70_000) },
  ])('rejects an unverified or delegated session header %#', async patch => {
    const { cwd, catalog, header, writeHeader } = await fixture();
    await writeHeader({ ...header, ...patch });
    await expect(catalog.canResumeSession(cwd, 'selected')).resolves.toBe(false);
  });

  it('does not treat an existing session in a different workspace as selected here', async () => {
    const { root, cwd, catalog, header, writeHeader } = await fixture();
    const other = path.join(root, 'other');
    await mkdir(other);
    await writeHeader({ ...header, cwd: other });
    await expect(catalog.canResumeSession(cwd, 'selected')).resolves.toBe(false);
  });

  it.each([{ archivedAt: '2026-09-22T00:00:00.000Z' }, { tags: [{ name: 'exec' }] },
    { tags: [{ name: 'decompSessionType', metadata: { value: 'worker' } }] },
  ])('keeps archived and background-only sessions out of cold recovery %#', async settings => {
    const { cwd, stored, catalog, header, writeHeader } = await fixture();
    await writeHeader(header);
    await writeFile(path.join(stored, 'selected.settings.json'), JSON.stringify(settings));
    await expect(catalog.canResumeSession(cwd, 'selected')).resolves.toBe(false);
  });

  it('rejects a missing record and path-like session ids', async () => {
    const { cwd, catalog } = await fixture();
    await expect(catalog.canResumeSession(cwd, 'selected')).resolves.toBe(false);
    await expect(catalog.canResumeSession(cwd, '../selected')).resolves.toBe(false);
  });
});
