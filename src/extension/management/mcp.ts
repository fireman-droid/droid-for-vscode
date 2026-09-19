import * as vscode from 'vscode';
import { authenticateDaemonMcp } from '../../runtime/daemon/mcpAuthentication';
import { changed, choose, confirm, ManagementError, requireSuccess, type ManagementContext } from './managementUi';

export async function manageMcp(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const servers = await context.droid.mcp.listServers(context.sessionId);
    const selected = await choose('Droid MCP tools and sign-in', [
      { label: 'Add from Droid registry…', action: 'registry' as const },
      ...servers.servers.map((row) => ({ label: row.name, description: row.status, action: 'server' as const, row })),
    ]);
    if (!selected) return;
    if (selected.action === 'registry') { await addRegistryServer(context, servers.servers.map((row) => row.name)); continue; }
    const name = selected.row.name;
    const action = await choose(name, [
      { label: 'Manage individual tools…', value: 'tools' },
      { label: 'Sign in using browser…', value: 'auth' },
      { label: 'Cancel pending sign-in', value: 'cancel' },
      { label: 'Clear saved sign-in', value: 'clear' },
    ]);
    if (!action) continue;
    if (action.value === 'tools') { await manageTools(context, name); continue; }
    if (action.value === 'auth') { await signInMcp(context, name); continue; }
    if (!await confirm(context, `${action.label.replace('…', '')} for MCP server "${name}"?`)) continue;
    if (action.value === 'cancel')
      requireSuccess(await context.droid.mcp.cancelAuth({ sessionId: context.sessionId, serverName: name }), 'sign-in cancellation');
    else if (action.value === 'clear')
      requireSuccess(await context.droid.mcp.clearAuth({ sessionId: context.sessionId, serverName: name }), 'clearing MCP credentials');
    context.assertCurrent();
    await changed('Droid confirmed the MCP credential operation.');
  }
}

async function addRegistryServer(context: ManagementContext, installed: readonly string[]): Promise<void> {
  const entries = (await context.droid.mcp.listRegistry(context.sessionId)).filter((row) => !installed.includes(row.name));
  if (!entries.length) { await changed('No additional servers are available in the Droid registry. Manual configuration remains available in the MCP panel.'); return; }
  const selected = await choose('Droid MCP registry', entries.map((row) => ({
    label: row.name, description: row.type, detail: row.description, row,
  })));
  if (!selected) return;
  const row = selected.row;
  if ((row.type === 'stdio' && !row.command) || (row.type !== 'stdio' && !row.url))
    throw new ManagementError('The registry entry has no usable command or endpoint. Configure it manually using the provider documentation.');
  if (row.url) {
    let endpoint: URL;
    try { endpoint = new URL(row.url); } catch { throw new ManagementError('The registry returned an invalid endpoint.'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new ManagementError('The registry endpoint must use HTTP(S) without embedded credentials.');
  }
  if (!await confirm(context, `Add "${row.name}" from the Droid registry (${row.type})? This may start a local MCP command or connect to an external service.`)) return;
  requireSuccess(await context.droid.mcp.addServer({
    sessionId: context.sessionId, name: row.name, type: row.type,
    ...(row.command === undefined ? {} : { command: row.command }),
    ...(row.args === undefined ? {} : { args: row.args }),
    ...(row.url === undefined ? {} : { url: row.url }),
  }), 'the registry server addition');
  context.assertCurrent();
}

export async function signInMcp(context: ManagementContext, name: string): Promise<void> {
  const catalog = await context.droid.mcp.listServers(context.sessionId);
  if (!catalog.servers.some((server) => server.name === name))
    throw new ManagementError('The MCP server changed. Refresh its catalog before signing in.');
  if (!await confirm(context, `Open browser sign-in for MCP server "${name}"?`)) return;
  const outcome = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification, title: `${name}: MCP sign-in`, cancellable: true,
  }, async (progress, token) => {
    const cancel = new AbortController();
    const cancellation = token.onCancellationRequested(() => cancel.abort());
    try {
      progress.report({ message: 'Waiting for Droid authentication…' });
      return await authenticateDaemonMcp({
        droid: context.droid, sessionId: context.sessionId, serverName: name,
        signal: AbortSignal.any([context.signal, cancel.signal]),
        requestCallback: async (url, signal) => {
          context.assertCurrent(true);
          if (!await vscode.env.openExternal(vscode.Uri.parse(url)))
            throw new ManagementError('The sign-in browser could not be opened.');
          if (signal.aborted) return undefined;
          progress.report({ message: 'Complete sign-in in the browser. A callback prompt is available if needed.' });
          const callback = await callbackInput(name, signal);
          if (!signal.aborted) context.assertCurrent(true);
          return callback;
        },
      });
    } finally { cancellation.dispose(); }
  });
  context.assertCurrent();
  if (outcome === 'failed') throw new ManagementError('Droid reported that MCP sign-in failed.');
  await changed(outcome === 'success' ? 'Droid confirmed MCP sign-in.' : 'MCP sign-in cancelled.');
}

async function manageTools(context: ManagementContext, serverName: string): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const tools = (await context.droid.mcp.listTools(context.sessionId)).filter((tool) => tool.serverName === serverName);
    if (!tools.length) { await changed('Droid has not exposed tools for this server. Check its connection or sign-in.'); return; }
    const selected = await choose(`${serverName}: tools`, tools.map((tool) => ({
      label: tool.name, description: `${tool.isEnabled ? 'Enabled' : 'Disabled'}${tool.isReadOnly ? ' · Read only' : ''}`,
      detail: tool.description, tool,
    })));
    if (!selected || !await confirm(context, `${selected.tool.isEnabled ? 'Disable' : 'Enable'} tool "${selected.tool.name}" on "${serverName}"?`)) return;
    const fresh = (await context.droid.mcp.listTools(context.sessionId)).find((tool) => tool.serverName === serverName && tool.name === selected.tool.name);
    context.assertCurrent(true);
    if (!fresh) throw new ManagementError('The tool catalog changed. Refresh before changing it.');
    requireSuccess(await context.droid.mcp.toggleTool(context.sessionId, serverName, fresh.name, !selected.tool.isEnabled), 'the tool change');
    context.assertCurrent();
  }
}

function callbackInput(serverName: string, signal: AbortSignal): Promise<string | undefined> {
  return new Promise((resolve) => {
    const input = vscode.window.createInputBox();
    input.title = `${serverName}: complete MCP sign-in`;
    input.prompt = 'Finish in your browser. If sign-in does not finish automatically, paste the final callback URL containing code and state. Escape cancels.';
    input.password = true;
    input.ignoreFocusOut = true;
    let settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      accept.dispose(); hide.dispose(); input.dispose();
      resolve(value);
    };
    const abort = () => finish();
    const accept = input.onDidAccept(() => {
      const value = input.value.trim();
      if (!value || value.length > 16_384) { input.validationMessage = 'Paste the complete callback URL (maximum 16,384 characters).'; return; }
      try {
        const url = new URL(value);
        if (url.username || url.password || !url.searchParams.has('state') ||
          (!url.searchParams.has('code') && !url.searchParams.has('error'))) throw new Error();
      } catch { input.validationMessage = 'The URL must contain state and code (or error), without embedded credentials.'; return; }
      finish(value);
    });
    const hide = input.onDidHide(() => finish());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish(); else input.show();
  });
}
