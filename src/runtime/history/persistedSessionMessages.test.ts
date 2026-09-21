import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonApi } from '../daemon/api';
import { createDaemonFirstHistoryLoader } from './DaemonSessionHistoryLoader';
import { readPersistedSessionMessages } from './persistedSessionMessages';
import * as historyProjection from './projectSessionHistory';
import { unavailableSessionHistory } from './SessionHistory';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});
const header = { type: 'session_start', version: 2, id: 'saved' };
const message = (id: string, role: string, content: unknown, time = 1, parentId?: string) => ({
  type: 'message', id, ...(parentId === undefined ? {} : { parentId }),
  timestamp: new Date(time).toISOString(), message: { role, content },
});
const text = (value: string) => [{ type: 'text', text: value }];
async function fixture(events: unknown[], suffix = '\n') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dvx-history-snapshot-'));
  directories.push(directory);
  const file = path.join(directory, 'saved.jsonl');
  await fs.writeFile(file, [header, ...events].map(event => JSON.stringify(event)).join('\n') + suffix);
  return { directory, file };
}
function loader(directory: string,
  getMessages: (id: string, options?: { cursor?: string; limit?: number }) => Promise<unknown[]> = vi.fn(async () => [])) {
  const fallback = { loadHistory: vi.fn(async () => unavailableSessionHistory()) };
  const getDroid = vi.fn(async () => ({ sessions: { getMessages } }) as unknown as DaemonApi);
  const diagnostics = { record: vi.fn() };
  return { getDroid, getMessages, fallback, diagnostics, load: createDaemonFirstHistoryLoader({
    sessionsDirectory: directory, isDaemonActive: () => true, getDroid, fallback, diagnostics,
  }) };
}
const request = { cwd: 'C:/workspace', sessionId: 'saved' };

describe('persisted history snapshot', () => {
  it('keeps tools, large results, image and metadata mappings identical to the public daemon format', async () => {
    const largeResult = 'result-line\n'.repeat(200_000);
    const { directory } = await fixture([
      message('prompt', 'user', text('Change this')),
      message('call', 'assistant', [
        { type: 'thinking', thinking: 'reason', signature: 'signature', durationMs: 30 },
        { type: 'tool_use', id: 'tool-1', name: 'MultiEdit', input: { file_path: 'C:/workspace/a.ts' },
          thought_signature: 'thought', script_execution: { run_id: 'run', outer_tool_use_id: 'outer' } },
      ], 2, 'prompt'),
      message('result', 'user', [
        { type: 'tool_result', tool_use_id: 'tool-1', is_error: false, content: [
          { type: 'text', text: largeResult }, { type: 'image', source: { data: 'aW1n', media_type: 'image/png' } },
        ] },
      ], 3, 'call'),
      { ...message('hidden', 'user', 'hidden text', 4, 'result'), message: { role: 'user', content: 'hidden text',
        visibility: 'model', hiddenFromUserViews: true, hookEventName: 'test' } },
      message('document', 'user', [{ type: 'document', source: { media_type: 'application/pdf', data: 'cGRm',
        parsed_data: 'parsed', name: 'a.pdf', path: '/a.pdf' } }], 5, 'hidden'),
    ], '');
    const loaded = await readPersistedSessionMessages(directory, 'saved');
    expect(loaded?.messages.map(item => item.id)).toEqual(['document', 'hidden', 'result', 'call', 'prompt']);
    expect(loaded?.messages[1]).toMatchObject({ role: 'user', visibility: 'model', hiddenFromUserViews: true,
      hookEventName: 'test', content: text('hidden text') });
    expect(loaded?.messages[2]).toMatchObject({ role: 'tool', content: [{ type: 'tool_result', toolUseId: 'tool-1',
      isError: false, content: [{ type: 'text', text: largeResult }, { type: 'image',
        source: { type: 'base64', data: 'aW1n', mediaType: 'image/png' } }] }] });
    expect(loaded?.messages[3]?.content[1]).toMatchObject({ type: 'tool_use', id: 'tool-1', name: 'Edit',
      thoughtSignature: 'thought', scriptExecution: { runId: 'run', outerToolUseId: 'outer' } });
    expect(loaded?.messages[0]?.content[0]).toMatchObject({ type: 'document', source: { type: 'base64',
      mediaType: 'application/pdf', parsedData: 'parsed', path: '/a.pdf' } });
  });

  it('normalizes branches, repeated ids and timestamp ties without moving an old branch to the tail', async () => {
    const { directory } = await fixture([
      message('old', 'user', text('old'), 1),
      message('branch', 'assistant', text('branch'), 2, 'old'),
      message('current', 'user', text('current'), 3, 'old'),
      message('latest', 'assistant', text('latest'), 4, 'current'),
      message('branch', 'assistant', text('updated branch'), 2, 'old'),
      message('tie', 'assistant', text('same timestamp'), 3, 'current'),
    ]);
    const read = loader(directory);
    const result = await read.load.loadHistory(request);
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.state.transcript.map(item => 'text' in item ? item.text : item.kind)).toEqual([
      'old', 'updated branch', 'same timestamp', 'current', 'latest',
    ]);
    expect(read.getDroid).not.toHaveBeenCalled();
    expect(read.fallback.loadHistory).not.toHaveBeenCalled();
  });

  it('retains the CLI precedence of nested message identity and time fields', async () => {
    const first = message('outer-first', 'user', text('first'));
    const second = message('outer-second', 'assistant', text('second'), 2, 'outer-first');
    const { directory } = await fixture([
      { ...first, message: { ...first.message, id: 'inner-first', createdAt: 101, updatedAt: 102 } },
      { ...second, message: { ...second.message, id: 'inner-second', parentId: 'inner-first', createdAt: 103 } },
    ]);
    const result = await readPersistedSessionMessages(directory, 'saved');
    expect(result?.messages).toMatchObject([
      { id: 'inner-second', parentId: 'inner-first', createdAt: 103, updatedAt: 2 },
      { id: 'inner-first', createdAt: 101, updatedAt: 102 },
    ]);
  });

  it.each(['partial tail', 'invalid header', 'invalid record'])('retains daemon pagination for %s', async (kind) => {
    const { directory, file } = await fixture([message('first', 'user', text('first'))]);
    if (kind === 'partial tail') await fs.appendFile(file, '{"type":"message","id":');
    if (kind === 'invalid header') await fs.writeFile(file, JSON.stringify({ ...header, version: 3 }) + '\n');
    if (kind === 'invalid record') await fs.appendFile(file, '{bad-json}\n');
    const getMessages = vi.fn(async () => [{ id: 'authoritative', role: 'user', content: text('daemon history'), createdAt: 1 }]);
    const read = loader(directory, getMessages);
    const result = await read.load.loadHistory(request);
    expect(result).toMatchObject({ status: 'available', state: { historyStatus: 'complete',
      transcript: [{ kind: 'user', text: 'daemon history' }] } });
    expect(getMessages).toHaveBeenCalledExactlyOnceWith('saved', { limit: 100 });
    expect(read.fallback.loadHistory).not.toHaveBeenCalled();
  });

  it('keeps settings sidecar totals and mission identity without connecting a daemon', async () => {
    const { directory } = await fixture([message('first', 'user', text('first'))]);
    await fs.writeFile(path.join(directory, 'saved.settings.json'), JSON.stringify({
      tokenUsage: { inputTokens: 10, outputTokens: 4, cacheCreationTokens: 0, cacheReadTokens: 0, thinkingTokens: 0 },
      tags: [{ name: 'decompSessionType', metadata: { value: 'worker' } }],
    }));
    const read = loader(directory);
    const result = await read.load.loadHistory(request);
    expect(result).toMatchObject({ status: 'available', tokenUsage: { inputTokens: 10, outputTokens: 4 },
      mission: { state: null, role: 'worker' } });
    expect(read.getDroid).not.toHaveBeenCalled();
  });

  it('tries the public daemon before the process fallback when snapshot projection is unavailable', async () => {
    const { directory } = await fixture([message('first', 'user', text('snapshot'))]);
    vi.spyOn(historyProjection, 'projectSessionMessages').mockReturnValueOnce(unavailableSessionHistory());
    const getMessages = vi.fn(async () => [{ id: 'daemon', role: 'user', content: text('public history'), createdAt: 1 }]);
    const read = loader(directory, getMessages);
    expect(await read.load.loadHistory(request)).toMatchObject({ status: 'available', state: {
      transcript: [{ kind: 'user', text: 'public history' }], historyStatus: 'complete',
    } });
    expect(getMessages).toHaveBeenCalledExactlyOnceWith('saved', { limit: 100 });
    expect(read.fallback.loadHistory).not.toHaveBeenCalled();
  });

  it('reads the initial complete prefix once while the active log grows', async () => {
    const { directory, file } = await fixture([message('first', 'user', text('start'))]);
    const initialBytes = (await fs.stat(file)).size;
    await interceptFirstRead(file, async () => {
      await fs.appendFile(file, JSON.stringify(message('appended', 'assistant', text('later'), 2, 'first')) + '\n');
    });
    const first = await readPersistedSessionMessages(directory, 'saved');
    expect(first?.bytes).toBe(initialBytes);
    expect(first?.messages.map(item => item.id)).toEqual(['first']);
    vi.restoreAllMocks();
    const next = await readPersistedSessionMessages(directory, 'saved');
    expect(next?.messages.map(item => item.id)).toEqual(['appended', 'first']);
  });

  it('rejects a snapshot truncated while reading instead of reporting complete history', async () => {
    const { directory, file } = await fixture([message('large', 'user', text('x'.repeat(2 * 1024 * 1024)))]);
    await interceptFirstRead(file, () => fs.truncate(file, 0));
    await expect(readPersistedSessionMessages(directory, 'saved')).resolves.toBeNull();
  });

  it('finds worktree and delegated histories outside the current cwd using the CLI directory rules', async () => {
    const { directory, file } = await fixture([message('first', 'user', text('saved elsewhere'))]);
    const elsewhere = path.join(directory, '-different-worktree');
    await fs.mkdir(elsewhere);
    await fs.rename(file, path.join(elsewhere, 'saved.jsonl'));
    const read = loader(directory);
    expect(await read.load.loadHistory(request)).toMatchObject({ status: 'available' });
    expect(read.getDroid).not.toHaveBeenCalled();
  });

  it('projects 6,420 large messages identically while removing 65 repeated whole-file reads', async () => {
    const events = Array.from({ length: 6_420 }, (_, index) => message(`m-${index}`, index % 2 ? 'assistant' : 'user',
      text(`message-${index}:` + 'x'.repeat(10_500)), index + 1, index === 0 ? undefined : `m-${index - 1}`));
    const { directory, file } = await fixture(events);
    const direct = loader(directory);
    let start = performance.now();
    const actual = await direct.load.loadHistory(request);
    const snapshotMs = performance.now() - start;
    expect(direct.getDroid).not.toHaveBeenCalled();

    // Emulate the verified CLI implementation, including rereading and parsing
    // every row on every page. No daemon, model or existing session is contacted.
    const getMessages = vi.fn(async (_id: string, options?: { cursor?: string }) => {
      const raw = await fs.readFile(file, 'utf8');
      const rows = raw.trim().split('\n').slice(1).map(line => {
        const event = JSON.parse(line) as ReturnType<typeof message>;
        return { id: event.id, parentId: event.parentId, createdAt: Date.parse(event.timestamp),
          updatedAt: Date.parse(event.timestamp), ...event.message };
      }).reverse();
      const first = options?.cursor === undefined ? 0 : rows.findIndex(row => row.id === options.cursor) + 1;
      return rows.slice(first, first + 100);
    });
    const missing = path.join(directory, 'no-persisted-copy');
    const paged = loader(missing, getMessages);
    start = performance.now();
    const expected = await paged.load.loadHistory(request);
    const pagedMs = performance.now() - start;
    expect(actual).toEqual(expected);
    expect(getMessages).toHaveBeenCalledTimes(65);
    expect(actual).toMatchObject({ status: 'available', state: { historyStatus: 'partial', truncated: true } });
    const bytes = (await fs.stat(file)).size;
    process.stdout.write(JSON.stringify({ scenario: '6420-message-local-history', bytes, snapshotReads: 1, pageReads: 65,
      snapshotMs: Math.round(snapshotMs), pagedMs: Math.round(pagedMs), avoidedReadBytes: bytes * 64 }) + '\n');
  }, 60_000);
});

async function interceptFirstRead(file: string, duringRead: () => Promise<void>): Promise<void> {
  const open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
    expect(args[0]).toBe(file);
    const handle = await open(...args);
    const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementationOnce((async (buffer: Buffer, offset: number, length: number, position: number) => {
      const result = await read(buffer, offset, length, position);
      await duringRead();
      return result;
    }) as typeof handle.read);
    return handle;
  });
}
