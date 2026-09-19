import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as vscode from 'vscode';
import type { DiagnosticsSink } from '../daemon/DaemonSidecar';

export interface OfficialIdeBinding {
  readonly port: number | null;
  readonly detail: string | null;
}

/** Resolve the native IDE endpoint; do not register a generic MCP server. */
export function createOfficialIdeConnection(diagnostics: DiagnosticsSink) {
  let pending: Promise<OfficialIdeBinding> | undefined;
  return {
    prepare(): Promise<OfficialIdeBinding> {
      if (pending) return pending;
      const attempt = prepare();
      pending = attempt;
      void attempt.finally(() => { if (pending === attempt) pending = undefined; });
      return attempt;
    },
  };

  async function prepare(): Promise<OfficialIdeBinding> {
    try {
      const extension = vscode.extensions.getExtension('Factory.factory-vscode-extension');
      if (!extension) {
        throw new Error('Install or enable the official Factory extension to prepare IDE integration.');
      }
      await extension.activate();
      const deadline = Date.now() + 5_000;
      do {
        const value = process.env.FACTORY_VSCODE_MCP_PORT;
        const port = value !== undefined && /^\d+$/u.test(value) ? Number(value) : 0;
        if (port > 0 && port <= 65_535 && await ownsLock(port)) {
          diagnostics.record({ level: 'info', name: 'ide.native.prepared', attributes: { port } });
          return { port, detail: null };
        }
        await delay(100);
      } while (Date.now() < deadline);
      throw new Error('The official IDE service for this window is not ready. Chat remains available.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The official IDE service is unavailable.';
      diagnostics.record({ level: 'warn', name: 'ide.native.unavailable', detail });
      return { port: null, detail };
    }
  }
}

async function ownsLock(port: number): Promise<boolean> {
  const file = join(homedir(), '.factory', 'ide', `${port}.lock`);
  let text: string;
  try {
    if ((await stat(file)).size > 16_384) throw new Error('Invalid official IDE discovery record.');
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  // The official server publishes its port before completing the lock-file write.
  if (!text.trim()) return false;
  const lock: unknown = JSON.parse(text);
  if (typeof lock !== 'object' || lock === null || Array.isArray(lock)) return false;
  const value = lock as Record<string, unknown>;
  if (value.pid !== process.pid || !Array.isArray(value.workspaceFolders) ||
      !value.workspaceFolders.every((folder): folder is string => typeof folder === 'string')) return false;
  const folders = vscode.workspace.workspaceFolders?.map((folder) => pathKey(folder.uri.fsPath)) ?? [];
  return folders.length > 0 && folders.length === value.workspaceFolders.length &&
    value.workspaceFolders.every((folder) => folders.includes(pathKey(folder)));
}

function pathKey(value: string): string {
  const path = resolve(value);
  return process.platform === 'win32' ? path.toLowerCase() : path;
}
