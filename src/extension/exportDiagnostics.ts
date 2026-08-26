import { createWriteStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { ZipFile } from 'yazl';
import * as vscode from 'vscode';

const LOG_FILE_PATTERN = /^droidvisx-\d{8}\.jsonl$/u;

/**
 * Packs every local diagnostics log file, an environment metadata file,
 * and the AI log-analysis playbook into one zip so the bundle can be
 * handed to an AI for offline debugging.
 */
export async function exportDiagnosticsBundle(
  context: vscode.ExtensionContext,
  logDirectory: string,
): Promise<void> {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, '')
    .slice(0, 13);
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(
      join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
          context.globalStorageUri.fsPath,
        `droidvisx-diagnostics-${timestamp}.zip`,
      ),
    ),
    filters: { 'Zip archive': ['zip'] },
    title: 'Export DroidVisX Diagnostics Bundle',
  });
  if (target === undefined) {
    return;
  }

  const zip = new ZipFile();
  let logCount = 0;
  try {
    for (const entry of (await readdir(logDirectory)).sort()) {
      if (LOG_FILE_PATTERN.test(entry)) {
        zip.addFile(join(logDirectory, entry), `logs/${entry}`);
        logCount += 1;
      }
    }
  } catch {
    // No log directory yet; the bundle still carries metadata.
  }

  const packageJson = context.extension.packageJSON as {
    version?: string;
    dependencies?: Record<string, string>;
  };
  const metadata = {
    exportedAt: new Date().toISOString(),
    extensionVersion: packageJson.version ?? 'unknown',
    droidSdkVersion:
      packageJson.dependencies?.['@factory/droid-sdk'] ?? 'unknown',
    vscodeVersion: vscode.version,
    appName: vscode.env.appName,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    workspace:
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null,
    logFileCount: logCount,
  };
  zip.addBuffer(
    Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'),
    'metadata.json',
  );

  // The playbook ships inside the VSIX so the bundle is self-describing
  // for whichever AI receives it.
  const playbookUri = vscode.Uri.joinPath(
    context.extensionUri,
    'docs',
    'TROUBLESHOOTING.md',
  );
  try {
    zip.addBuffer(
      Buffer.from(await vscode.workspace.fs.readFile(playbookUri)),
      'TROUBLESHOOTING.md',
    );
  } catch {
    // A missing playbook copy must not block the export.
  }

  zip.end();
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(target.fsPath);
    output.on('error', reject);
    output.on('close', () => resolve());
    zip.outputStream.on('error', reject);
    zip.outputStream.pipe(output);
  });

  const action = await vscode.window.showInformationMessage(
    `DroidVisX diagnostics bundle exported (${logCount} log file${logCount === 1 ? '' : 's'}).`,
    'Reveal in Explorer',
  );
  if (action === 'Reveal in Explorer') {
    await vscode.commands.executeCommand('revealFileInOS', target);
  }
}
