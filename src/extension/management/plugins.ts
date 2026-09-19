import * as vscode from 'vscode';
import type { DaemonApi } from '../../runtime/daemon/api';
import { changed, choose, confirm, ManagementError, requireSuccess, textInput, type ManagementContext } from './managementUi';

export async function managePlugins(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const rows = await context.droid.plugins.listInstalled(context.sessionId);
    const selected = await choose('Droid plugins', [
      { label: 'Install a plugin…', action: 'install' as const },
      { label: 'Manage marketplaces…', action: 'marketplaces' as const },
      { label: 'Refresh', action: 'refresh' as const },
      ...rows.map((row) => ({
        label: row.id, description: `${row.scope} · ${row.version} · ${row.active ? 'Active' : 'Off'}${row.managed ? ' · Managed' : ''}`,
        action: 'plugin' as const, row,
      })),
    ]);
    if (!selected) return;
    context.assertCurrent();
    if (selected.action === 'install') await installPlugin(context);
    else if (selected.action === 'marketplaces') await manageMarketplaces(context);
    else if ('row' in selected) {
      const row = selected.row;
      if (row.managed || !['user', 'project'].includes(row.scope)) {
        await changed('This plugin is managed by policy or has an unsupported scope. Local changes are unavailable.');
        continue;
      }
      const action = await choose(row.id, [
        { label: row.active ? 'Disable' : 'Enable', action: 'toggle' },
        { label: 'Update', action: 'update' },
        { label: 'Uninstall', action: 'uninstall' },
      ]);
      if (!action || !await confirm(context, `${action.label} plugin "${row.id}" in ${row.scope} scope? Plugins can provide executable hooks, tools and commands.`)) continue;
      const fresh = (await context.droid.plugins.listInstalled(context.sessionId, row.scope))
        .find((item) => item.id === row.id && item.scope === row.scope);
      context.assertCurrent(true);
      if (!fresh || fresh.managed) throw new ManagementError('The plugin or its policy changed. Refresh before changing it.');
      if (action.action === 'toggle')
        requireSuccess(await context.droid.plugins.setEnabled(context.sessionId, row.id, row.scope, !row.active), 'the plugin change');
      else if (action.action === 'uninstall')
        requireSuccess(await context.droid.plugins.uninstall(context.sessionId, row.id, row.scope), 'plugin removal');
      else {
        const result = await context.droid.plugins.update(context.sessionId, row.id, row.scope);
        if (result.results.length === 0 || result.results.some((item) => !item.success))
          throw new ManagementError('One or more plugin updates were not confirmed. Refresh to inspect any partial updates.');
      }
      context.assertCurrent();
      await changed('Droid confirmed the plugin change. Start a new session if the current session still uses its previous tools.');
    }
  }
}

async function installPlugin(context: ManagementContext): Promise<void> {
  const available = await context.droid.plugins.listAvailable(context.sessionId);
  if (!available.length) { await changed('No plugins are available. Add or refresh a marketplace first.'); return; }
  const plugin = await choose('Install a Droid plugin', available.map((row) => ({
    label: row.name, description: row.marketplace, detail: row.description, row,
  })));
  if (!plugin) return;
  const scope = await choose('Plugin scope', [{ label: 'Project', value: 'project' }, { label: 'User', value: 'user' }]);
  if (!scope || !await confirm(context, `Install "${plugin.row.name}" from "${plugin.row.marketplace}" in ${scope.value} scope? Only install sources you trust; plugins may execute code.`)) return;
  requireSuccess(await context.droid.plugins.install(context.sessionId, plugin.row.marketplace, plugin.row.name, scope.value), 'plugin installation');
  context.assertCurrent();
  await changed('Droid confirmed installation. The installed catalog will refresh.');
}

export async function manageMarketplaces(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const rows = await context.droid.marketplaces.list(context.sessionId);
    const selected = await choose('Droid plugin marketplaces', [
      { label: 'Add marketplace…', action: 'add' as const },
      { label: 'Refresh', action: 'refresh' as const },
      ...rows.map((row) => ({
        label: row.displayName ?? row.name,
        description: `${row.pluginCount} plugins${row.provisionedBy ? ` · Managed: ${row.provisionedBy}` : ''}`,
        action: 'marketplace' as const, row,
      })),
    ]);
    if (!selected) return;
    if (selected.action === 'add') { await addMarketplace(context); continue; }
    if (!('row' in selected)) continue;
    const row = selected.row;
    const action = await choose(row.name, [
      { label: 'Update marketplace', value: 'update' },
      ...(!row.provisionedBy && row.removable !== false ? [{ label: 'Remove marketplace', value: 'remove' }] : []),
    ]);
    if (!action || !await confirm(context, `${action.label} "${row.name}"? Existing plugin configuration is controlled by Droid.`)) continue;
    const fresh = (await context.droid.marketplaces.list(context.sessionId)).find((item) => item.name === row.name);
    context.assertCurrent(true);
    if (!fresh || (action.value === 'remove' && (fresh.provisionedBy || fresh.removable === false)))
      throw new ManagementError('The marketplace or its policy changed. Refresh before changing it.');
    if (action.value === 'remove')
      requireSuccess(await context.droid.marketplaces.remove(context.sessionId, row.name), 'marketplace removal');
    else {
      const result = await context.droid.marketplaces.update(context.sessionId, row.name);
      if (result.results.length === 0 || result.results.some((item) => !item.success))
        throw new ManagementError('One or more marketplace updates were not confirmed. Refresh to inspect any partial updates.');
    }
    context.assertCurrent();
    await changed('Droid confirmed the marketplace change.');
  }
}

async function addMarketplace(context: ManagementContext): Promise<void> {
  const kind = await choose('Marketplace source', [
    { label: 'GitHub repository', value: 'github' as const },
    { label: 'Git HTTPS URL', value: 'url' as const },
    { label: 'Git repository subdirectory', value: 'git-subdir' as const },
    { label: 'Local directory', value: 'local' as const },
  ]);
  if (!kind) return;
  let source: Parameters<DaemonApi['marketplaces']['add']>[1];
  if (kind.value === 'local') {
    const directories = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Select marketplace directory' });
    if (!directories?.[0]) return;
    source = { source: 'local', path: directories[0].fsPath };
  } else {
    const input = await textInput('Marketplace source', kind.value === 'github' ? 'Repository in owner/name form' : 'HTTPS repository URL without credentials, query or fragment', 2048);
    if (!input) return;
    if (kind.value === 'github') {
      if (!/^[\w.-]+\/[\w.-]+$/.test(input)) throw new ManagementError('Use a GitHub repository in owner/name form.');
      source = { source: 'github', repo: input };
    } else {
      let url: URL;
      try { url = new URL(input); } catch { throw new ManagementError('Enter a valid HTTPS repository URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        throw new ManagementError('Use an HTTPS repository URL without credentials, query or fragment.');
      if (kind.value === 'git-subdir') {
        const path = await textInput('Marketplace subdirectory', 'Relative directory inside the repository');
        if (!path) return;
        if (/^(?:[/\\]|[a-z]:)/i.test(path) || path.split(/[/\\]/).includes('..'))
          throw new ManagementError('Use a relative subdirectory without parent traversal.');
        source = { source: 'git-subdir', url: url.href, path };
      } else source = { source: 'url', url: url.href };
    }
  }
  if (!await confirm(context, 'Add this marketplace to Droid? Only add a source you trust; its plugins can provide executable code.')) return;
  requireSuccess(await context.droid.marketplaces.add(context.sessionId, source), 'the marketplace addition');
  context.assertCurrent();
}
