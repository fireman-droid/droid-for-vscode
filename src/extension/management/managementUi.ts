import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';

export class ManagementError extends Error {}

export interface ManagementContext {
  readonly droid: DaemonApi;
  readonly sessionId: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
  assertCurrent(write?: boolean): void;
}

export async function choose<T extends vscode.QuickPickItem>(title: string, items: readonly T[]): Promise<T | undefined> {
  return vscode.window.showQuickPick(items, { title, ignoreFocusOut: true, matchOnDescription: true, matchOnDetail: true });
}

export async function confirm(context: ManagementContext, message: string): Promise<boolean> {
  context.assertCurrent(true);
  const answer = await vscode.window.showWarningMessage(message, { modal: true }, 'Continue');
  context.assertCurrent(true);
  return answer === 'Continue';
}

export function requireSuccess(result: { readonly success: boolean }, operation: string): void {
  if (!result.success) throw new ManagementError(`Droid did not confirm ${operation}. Refresh and check its configuration or organization policy.`);
}

export async function changed(message: string): Promise<void> {
  await vscode.window.showInformationMessage(message);
}

export async function textInput(title: string, prompt: string, maxLength = 512): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title, prompt, ignoreFocusOut: true,
    validateInput: (value) => !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)
      ? `Enter between 1 and ${maxLength} characters without control characters.` : undefined,
  });
  return value?.trim();
}

export async function inspectText(title: string, content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `${title}\n\n${content}` });
  await vscode.window.showTextDocument(document, { preview: true });
}

export async function editText(title: string, value: string, maxLength = 20_000): Promise<string | undefined> {
  const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: value });
  await vscode.window.showTextDocument(document, { preview: false });
  const choice = await vscode.window.showInformationMessage(`${title}: edit the untitled document, then choose Use content. Nothing is saved automatically.`, 'Use content', 'Cancel');
  if (choice !== 'Use content') return undefined;
  const text = document.getText();
  if (!text.trim() || text.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new ManagementError(`Enter non-empty text up to ${maxLength} characters without control characters.`);
  return text;
}
