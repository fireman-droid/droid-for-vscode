import { join } from 'node:path';

import * as vscode from 'vscode';

import {
  MAX_BRIDGE_ID_LENGTH,
  type SessionTranscriptItem,
} from '../shared/bridgeMessages';
import { isStrictRecord } from '../shared/strictValidation';
import type { SessionCatalogResult } from '../runtime/SessionCatalog';
import type {
  SessionHistoryRequest,
  SessionHistoryResult,
} from '../runtime/history/SessionHistory';
import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import { scrubCredentials } from './LocalDiagnostics';

export interface SessionExportMetadata {
  readonly title: string;
  readonly sessionId: string;
  /** ISO timestamp; omitted from the header when absent or invalid. */
  readonly createdTime?: string;
  readonly exportedAt: Date;
  readonly workspacePath: string | null;
  readonly truncated: boolean;
}

const FALLBACK_TITLE = 'Droid session';
const MAX_FILE_NAME_SLUG_LENGTH = 60;

/**
 * Renders one Droid session transcript as a standalone Markdown
 * document. Assistant text is kept verbatim (it already is Markdown),
 * thinking blocks are omitted, tool calls collapse to one-line records
 * with an optional blockquoted detail, and images become placeholders.
 * The finished document passes through `scrubCredentials` once so
 * credential-shaped values never leave the machine in plain text.
 */
export function renderSessionMarkdown(
  metadata: SessionExportMetadata,
  transcript: readonly SessionTranscriptItem[],
): string {
  const lines: string[] = [];
  lines.push(`# ${metadata.title}`, '');
  lines.push(`- **Session:** ${inlineCode(metadata.sessionId)}`);
  const created = parseIsoDate(metadata.createdTime);
  if (created !== null) {
    lines.push(`- **Created:** ${formatDateTime(created)}`);
  }
  lines.push(`- **Exported:** ${formatDateTime(metadata.exportedAt)}`);
  if (metadata.workspacePath !== null) {
    lines.push(`- **Workspace:** ${inlineCode(metadata.workspacePath)}`);
  }
  lines.push('');
  lines.push(
    '> Exported by DroidVisX. Thinking blocks are omitted, tool calls',
    '> are collapsed to one-line records, images are placeholders, and',
    '> credential-shaped values are replaced with `[REDACTED]`.',
  );
  if (metadata.truncated) {
    lines.push(
      '>',
      '> This transcript is partial: earlier or oversized content was',
      '> truncated before export.',
    );
  }
  lines.push('', '---');

  let section: 'user' | 'assistant' | null = null;
  const ensureSection = (next: 'user' | 'assistant'): void => {
    if (section !== next) {
      section = next;
      lines.push('', `## ${next === 'user' ? 'User' : 'Assistant'}`);
    }
  };

  for (const item of transcript) {
    switch (item.kind) {
      case 'user': {
        ensureSection('user');
        if (item.text.length > 0) {
          lines.push('', item.text);
        }
        if (item.attachments !== undefined && item.attachments.length > 0) {
          const summary = item.attachments
            .map(
              (attachment) =>
                `${inlineCode(attachment.name)} (${attachment.kind}, ${formatBytes(attachment.sizeBytes)})`,
            )
            .join(', ');
          lines.push('', `*Attachments:* ${summary}`);
        }
        break;
      }
      case 'assistant':
        ensureSection('assistant');
        if (item.text.length > 0) {
          lines.push('', item.text);
        }
        break;
      case 'thinking':
        break;
      case 'tool': {
        ensureSection('assistant');
        const parts = [
          `**${inlineCode(item.toolName)}**`,
          item.action,
        ];
        if (item.filePath !== undefined) {
          parts.push(inlineCode(item.filePath));
        }
        if (item.status === 'failed') {
          parts.push('failed');
        }
        lines.push('', `- ${parts.join(' — ')}`);
        if (item.detail !== undefined) {
          for (const detailLine of item.detail.split('\n')) {
            lines.push(`  > ${detailLine}`.trimEnd());
          }
        }
        break;
      }
      case 'changes': {
        ensureSection('assistant');
        const files = item.files
          .map((file) => {
            const counts =
              file.additions === null || file.deletions === null
                ? ''
                : ` (+${file.additions} −${file.deletions})`;
            return `${inlineCode(file.path)}${counts}`;
          })
          .join(', ');
        lines.push('', `- *Changed files:* ${files}`);
        break;
      }
      case 'ask-user-result':
        ensureSection('assistant');
        if (item.status === 'cancelled') {
          lines.push('', '> **Question cancelled**');
          break;
        }
        lines.push('', '**Your answers**');
        for (const { topic, answer } of item.answers) {
          lines.push(`- **${escapeMarkdownLabel(topic)}:** ${answer}`);
        }
        break;
      case 'image':
        ensureSection(item.origin === 'user' ? 'user' : 'assistant');
        lines.push(
          '',
          `*[Image: ${item.mediaType}, ${formatBytes(item.byteLength)}]*`,
        );
        break;
      case 'diagnostic':
        lines.push(
          '',
          `> *Diagnostic (${item.severity}${item.code.length > 0 ? `, ${item.code}` : ''}):* ${item.message}`,
        );
        break;
    }
  }

  lines.push('');
  return scrubCredentials(lines.join('\n'));
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('*', '\\*');
}

/**
 * Windows-safe default file name: a bounded slug of the session title
 * plus the local export date, e.g. `droid-session-fix-login-20260812.md`.
 */
export function sessionExportFileName(title: string, date: Date): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, MAX_FILE_NAME_SLUG_LENGTH)
      .replace(/-+$/gu, '') || 'untitled';
  const stamp = `${String(date.getFullYear()).padStart(4, '0')}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `droid-session-${slug}-${stamp}.md`;
}

/**
 * Reads the selected session id straight from the persisted recovery
 * state, for when the export command runs before the chat view has
 * loaded the in-memory recovery store.
 */
export function readPersistedSelectedSessionId(
  value: unknown,
): string | null {
  if (!isStrictRecord(value)) {
    return null;
  }
  const selected = value.selectedSessionId;
  return typeof selected === 'string' &&
    selected.length > 0 &&
    selected.length <= MAX_BRIDGE_ID_LENGTH
    ? selected
    : null;
}

export interface SessionExportDependencies {
  readonly getActiveSessionId: () => string | null;
  readonly getWorkspaceCwd: () => string | null;
  readonly loadHistory: (
    request: SessionHistoryRequest,
  ) => Promise<SessionHistoryResult>;
  readonly listSessions: (cwd: string) => Promise<SessionCatalogResult>;
  readonly diagnostics: Pick<RuntimeDiagnosticSink, 'record'>;
}

/**
 * `DroidVisX: Export Session as Markdown`. Loads the active session's
 * saved history through the existing loader pipeline, renders it, and
 * writes it to a user-chosen path.
 */
export async function exportActiveSessionAsMarkdown(
  deps: SessionExportDependencies,
): Promise<void> {
  const sessionId = deps.getActiveSessionId();
  if (sessionId === null) {
    void vscode.window.showInformationMessage(
      'No active Droid session to export. Open the DroidVisX chat and select a session first.',
    );
    return;
  }
  const cwd = deps.getWorkspaceCwd();
  if (cwd === null) {
    void vscode.window.showInformationMessage(
      'Open a workspace folder to export a Droid session.',
    );
    return;
  }

  try {
    const history = await deps.loadHistory({ cwd, sessionId });
    if (history.status === 'unavailable') {
      deps.diagnostics.record({
        level: 'warn',
        name: 'session.export.history-unavailable',
        attributes: { sessionId },
      });
      void vscode.window.showErrorMessage(history.message);
      return;
    }

    let title = FALLBACK_TITLE;
    let createdTime: string | undefined;
    // Title and creation date are presentation garnish; a catalog
    // failure must not block the export.
    try {
      const catalog = await deps.listSessions(cwd);
      if (catalog.status === 'available') {
        const entry = catalog.sessions.find(
          (session) => session.id === sessionId,
        );
        if (entry !== undefined) {
          title = entry.title;
          createdTime = entry.createdTime;
        }
      }
    } catch {
      // Keep the fallback title.
    }

    const exportedAt = new Date();
    const markdown = renderSessionMarkdown(
      {
        title,
        sessionId,
        ...(createdTime === undefined ? {} : { createdTime }),
        exportedAt,
        workspacePath: cwd,
        truncated: history.state.truncated,
      },
      history.state.transcript,
    );

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        join(cwd, sessionExportFileName(title, exportedAt)),
      ),
      filters: { Markdown: ['md'] },
      title: 'Export Droid Session as Markdown',
    });
    if (target === undefined) {
      return;
    }
    await vscode.workspace.fs.writeFile(
      target,
      Buffer.from(markdown, 'utf8'),
    );
    deps.diagnostics.record({
      level: 'info',
      name: 'session.export.completed',
      attributes: {
        sessionId,
        items: history.state.transcript.length,
        bytes: Buffer.byteLength(markdown, 'utf8'),
      },
    });

    const action = await vscode.window.showInformationMessage(
      'Droid session exported as Markdown.',
      'Open File',
    );
    if (action === 'Open File') {
      await vscode.window.showTextDocument(target);
    }
  } catch (error) {
    deps.diagnostics.record({
      level: 'error',
      name: 'session.export.failed',
      detail:
        error instanceof Error
          ? (error.stack ?? error.message)
          : String(error),
    });
    void vscode.window.showErrorMessage(
      'DroidVisX session export failed. See DroidVisX Logs.',
    );
  }
}

function inlineCode(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateTime(date: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
