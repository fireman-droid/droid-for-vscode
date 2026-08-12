import { describe, expect, it, vi } from 'vitest';

// The pure renderer and file-name helpers never touch the vscode API;
// the module-level import only serves the command function.
vi.mock('vscode', () => ({}));

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import {
  readPersistedSelectedSessionId,
  renderSessionMarkdown,
  sessionExportFileName,
  type SessionExportMetadata,
} from './sessionExporter';

const metadata = (
  overrides: Partial<SessionExportMetadata> = {},
): SessionExportMetadata => ({
  title: 'Fix login bug',
  sessionId: 'session-abc',
  createdTime: '2026-08-10T02:30:00.000Z',
  exportedAt: new Date(2026, 7, 12, 14, 5),
  workspacePath: 'D:\\projects\\demo',
  truncated: false,
  ...overrides,
});

const user = (
  text: string,
  extra: Partial<Extract<SessionTranscriptItem, { kind: 'user' }>> = {},
): SessionTranscriptItem => ({
  id: `user-${text.slice(0, 8)}`,
  kind: 'user',
  text,
  ...extra,
});

const assistant = (text: string, id = 'a1'): SessionTranscriptItem => ({
  id,
  kind: 'assistant',
  turnId: 'turn-1',
  text,
});

const tool = (
  overrides: Partial<Extract<SessionTranscriptItem, { kind: 'tool' }>> = {},
): SessionTranscriptItem => ({
  id: overrides.id ?? 'tool-1',
  kind: 'tool',
  turnId: 'turn-1',
  toolUseId: 'use-1',
  toolName: 'Edit',
  action: 'Edit file',
  status: 'completed',
  progressCount: 0,
  latestUpdateKind: null,
  ...overrides,
});

describe('renderSessionMarkdown', () => {
  it('renders header, ordered user/assistant sections, and verbatim assistant markdown', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      user('Please fix the login bug.'),
      assistant('Found it.\n\n```ts\nconst ok = true;\n```'),
      user('Thanks!', { id: 'user-2' }),
    ]);

    expect(markdown).toContain('# Fix login bug');
    expect(markdown).toContain('- **Session:** `session-abc`');
    expect(markdown).toContain('- **Exported:** 2026-08-12 14:05');
    expect(markdown).toContain('- **Workspace:** `D:\\projects\\demo`');
    expect(markdown).toContain('> Exported by DroidVisX. Thinking blocks are omitted');

    const firstUser = markdown.indexOf('## User');
    const firstAssistant = markdown.indexOf('## Assistant');
    const secondUser = markdown.indexOf('## User', firstUser + 1);
    expect(firstUser).toBeGreaterThan(-1);
    expect(firstAssistant).toBeGreaterThan(firstUser);
    expect(secondUser).toBeGreaterThan(firstAssistant);
    // Assistant markdown stays verbatim, fences included.
    expect(markdown).toContain('```ts\nconst ok = true;\n```');
  });

  it('merges consecutive assistant-flow items under one heading', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      user('go'),
      tool(),
      assistant('Done.'),
    ]);
    expect(markdown.match(/## Assistant/gu)).toHaveLength(1);
  });

  it('lists user attachments by file name', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      user('See screenshot.', {
        attachments: [
          { kind: 'image', name: 'error.png', sizeBytes: 2048 },
        ],
      }),
    ]);
    expect(markdown).toContain('*Attachments:* `error.png` (image, 2.0 KB)');
  });

  it('omits thinking blocks entirely', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      {
        id: 'th-1',
        kind: 'thinking',
        turnId: 'turn-1',
        text: 'secret reasoning trail',
        status: 'complete',
        truncated: false,
      },
      assistant('Answer.'),
    ]);
    expect(markdown).not.toContain('secret reasoning trail');
    expect(markdown).toContain('Answer.');
  });

  it('collapses tool calls to one line with a blockquoted detail', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      tool({
        toolName: 'Bash',
        action: 'Run command',
        detailKind: 'command',
        detail: 'pnpm test\npnpm run build',
      }),
    ]);
    expect(markdown).toContain('- **`Bash`** — Run command');
    expect(markdown).toContain('  > pnpm test');
    expect(markdown).toContain('  > pnpm run build');
  });

  it('marks failed tools and includes the file path', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      tool({ filePath: 'src/auth/login.ts', status: 'failed' }),
      tool({ id: 'tool-2', toolUseId: 'use-2', status: 'completed' }),
    ]);
    expect(markdown).toContain(
      '- **`Edit`** — Edit file — `src/auth/login.ts` — failed',
    );
    // Completed stays quiet: no status suffix.
    expect(markdown).toContain('- **`Edit`** — Edit file\n');
  });

  it('renders changed files with counts only when known', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      {
        id: 'ch-1',
        kind: 'changes',
        turnId: 'turn-1',
        files: [
          { path: 'src/a.ts', additions: 3, deletions: 1 },
          { path: 'src/b.ts', additions: null, deletions: null },
        ],
      },
    ]);
    expect(markdown).toContain(
      '- *Changed files:* `src/a.ts` (+3 −1), `src/b.ts`',
    );
  });

  it('replaces images with placeholders in the owning section', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      {
        id: 'img-1',
        kind: 'image',
        turnId: 'turn-1',
        origin: 'user',
        mediaType: 'image/png',
        data: '',
        generated: false,
        byteLength: 3 * 1024 * 1024,
      },
    ]);
    expect(markdown).toContain('## User');
    expect(markdown).toContain('*[Image: image/png, 3.0 MB]*');
    expect(markdown).not.toContain('## Assistant');
  });

  it('renders diagnostics as quiet notes', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      {
        id: 'diag-1',
        kind: 'diagnostic',
        turnId: null,
        severity: 'warning',
        code: 'session-compacted',
        message: 'Earlier messages were summarized.',
      },
    ]);
    expect(markdown).toContain(
      '> *Diagnostic (warning, session-compacted):* Earlier messages were summarized.',
    );
  });

  it('scrubs credential-shaped values from every part of the document', () => {
    const markdown = renderSessionMarkdown(metadata(), [
      user('my key is sk-abcdefghijklmnop1234 please keep it'),
      tool({
        toolName: 'Bash',
        action: 'Run command',
        detailKind: 'command',
        detail: 'curl -H "Authorization: Bearer abcdef123456789"',
      }),
      assistant('set password: hunter2hunter in .env'),
    ]);
    expect(markdown).not.toContain('sk-abcdefghijklmnop1234');
    expect(markdown).not.toContain('Bearer abcdef123456789');
    expect(markdown).not.toContain('hunter2hunter');
    expect(markdown.match(/\[REDACTED\]/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it('notes truncation in the header only when the history is partial', () => {
    const partial = renderSessionMarkdown(metadata({ truncated: true }), []);
    const complete = renderSessionMarkdown(metadata(), []);
    expect(partial).toContain('This transcript is partial');
    expect(complete).not.toContain('This transcript is partial');
  });

  it('omits created and workspace lines when unknown', () => {
    const markdown = renderSessionMarkdown(
      metadata({ createdTime: undefined, workspacePath: null }),
      [],
    );
    expect(markdown).not.toContain('- **Created:**');
    expect(markdown).not.toContain('- **Workspace:**');
  });
});

describe('sessionExportFileName', () => {
  const date = new Date(2026, 7, 12, 14, 5);

  it('slugs the title and stamps the local date', () => {
    expect(sessionExportFileName('Fix login bug', date)).toBe(
      'droid-session-fix-login-bug-20260812.md',
    );
  });

  it('strips characters that are unsafe in Windows file names', () => {
    expect(
      sessionExportFileName('Fix: build/deploy "loop"?', date),
    ).toBe('droid-session-fix-build-deploy-loop-20260812.md');
  });

  it('keeps non-ASCII titles', () => {
    expect(sessionExportFileName('修复登录问题', date)).toBe(
      'droid-session-修复登录问题-20260812.md',
    );
  });

  it('falls back for empty titles and bounds long ones', () => {
    expect(sessionExportFileName('***', date)).toBe(
      'droid-session-untitled-20260812.md',
    );
    const long = sessionExportFileName('a'.repeat(200), date);
    expect(long.length).toBeLessThanOrEqual(
      'droid-session--20260812.md'.length + 60,
    );
    expect(long.endsWith('-20260812.md')).toBe(true);
  });
});

describe('readPersistedSelectedSessionId', () => {
  it('reads the selected id from a persisted recovery state', () => {
    expect(
      readPersistedSelectedSessionId({
        version: 1,
        selectedSessionId: 'session-xyz',
        sessions: [],
      }),
    ).toBe('session-xyz');
  });

  it('returns null for missing, empty, or malformed values', () => {
    expect(readPersistedSelectedSessionId(undefined)).toBeNull();
    expect(readPersistedSelectedSessionId(null)).toBeNull();
    expect(readPersistedSelectedSessionId('session-xyz')).toBeNull();
    expect(
      readPersistedSelectedSessionId({ selectedSessionId: '' }),
    ).toBeNull();
    expect(
      readPersistedSelectedSessionId({ selectedSessionId: 42 }),
    ).toBeNull();
    expect(
      readPersistedSelectedSessionId({
        selectedSessionId: 'x'.repeat(10_000),
      }),
    ).toBeNull();
  });
});
