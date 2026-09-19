import * as path from 'node:path';
import * as vscode from 'vscode';
import { SettingsLevel } from '@factory/droid-sdk';
import type { DaemonApi } from '../../runtime/daemon/api';
import { changed, choose, confirm, ManagementError, requireSuccess, type ManagementContext } from './managementUi';

type Skill = Awaited<ReturnType<DaemonApi['skills']['list']>>['skills'][number];

export async function manageSkills(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const catalog = await context.droid.skills.list(context.sessionId);
    const selected = await choose('Droid skills: inspect and manage scope', catalog.skills.map((skill) => ({
      label: skill.name,
      description: `${skill.location} · ${skill.enabled === false ? 'Disabled' : 'Enabled'}${skill.version ? ` · ${skill.version}` : ''}`,
      detail: skill.description, skill,
    })));
    if (!selected) return;
    context.assertCurrent();
    const skill = selected.skill;
    const action = await choose(skill.name, [
      { label: 'Inspect definition and resources', description: 'Inspection snapshot, separate from the definition file', action: 'inspect' },
      { label: 'Open definition file…', description: 'Edit the local skill source using the editor', action: 'source' },
      { label: 'Manage user-level enablement…', description: describeDisabledBy(skill), action: 'user' },
      ...(catalog.projectAvailable ? [{ label: 'Manage project-level enablement…', description: 'Only this project', action: 'project' }] : []),
    ]);
    if (!action) continue;
    if (action.action === 'inspect') {
      const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: describeSkill(skill) });
      context.assertCurrent();
      await vscode.window.showTextDocument(document, { preview: true });
      continue;
    }
    if (action.action === 'source') {
      if (!path.isAbsolute(skill.filePath)) throw new ManagementError('Droid did not provide an absolute local definition path.');
      if (!await confirm(context, `Open the local definition for "${skill.name}" in the editor?\n${skill.filePath}\nEdits are saved only when you choose to save the file.`)) continue;
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(skill.filePath)), { preview: false });
      continue;
    }
    const settingsLevel = action.action === 'project' ? SettingsLevel.Project : SettingsLevel.User;
    const disabledHere = skill.disabledBy?.kind === 'ledger' && skill.disabledBy.sources.some((source) => source.level === settingsLevel);
    const choice = await choose(`${skill.name}: ${settingsLevel} scope`, [
      { label: 'Disable in this scope', description: disabledHere ? 'Already disabled here' : 'Add a disablement entry', disabled: true },
      { label: 'Enable in this scope', description: 'Remove this scope’s disablement; other sources may still disable it', disabled: false },
    ]);
    if (!choice || !await confirm(context, `${choice.disabled ? 'Disable' : 'Enable'} skill "${skill.name}" in ${settingsLevel} scope? Other scopes and frontmatter remain authoritative. Changes take effect in new sessions.`)) continue;
    const freshCatalog = await context.droid.skills.list(context.sessionId);
    context.assertCurrent(true);
    const matches = freshCatalog.skills.filter((item) => item.name === skill.name);
    if (matches.length !== 1 || matches[0]!.filePath !== skill.filePath ||
      (settingsLevel === SettingsLevel.Project && !freshCatalog.projectAvailable))
      throw new ManagementError('The skill identity or project scope changed. Refresh before changing it.');
    requireSuccess(await context.droid.skills.setDisabled({
      sessionId: context.sessionId, skillName: skill.name, disabled: choice.disabled, settingsLevel,
    }), 'the skill scope update');
    context.assertCurrent();
    const updated = (await context.droid.skills.list(context.sessionId)).skills.find((item) => item.name === skill.name && item.filePath === skill.filePath);
    context.assertCurrent();
    await changed(updated ? `Droid confirmed the ${settingsLevel} setting. Current effective state: ${updated.enabled === false ? 'disabled' : 'enabled'}. ${describeDisabledBy(updated)} Start a new session to load the change.`
      : 'Droid confirmed the setting, but the skill is no longer in the catalog. Refresh before continuing.');
  }
}

function describeDisabledBy(skill: Skill): string {
  if (skill.disabledBy?.kind === 'frontmatter') return 'Disabled by the skill frontmatter. Scope toggles do not edit that definition.';
  if (skill.disabledBy?.kind === 'ledger') return `Disabled by: ${skill.disabledBy.sources.map((source) =>
    `${source.level}${source.folderPath ? ` (${source.folderPath})` : ''}`).join(', ')}.`;
  return skill.enabled === false ? 'Droid did not report a disablement source.' : 'No disablement source reported.';
}

function describeSkill(skill: Skill): string {
  return [
    skill.name, skill.description ?? '', '',
    `Location: ${skill.location}`, `Definition: ${skill.filePath}`,
    `Version: ${skill.version ?? 'not reported'}`,
    `Effective state: ${skill.enabled === false ? 'disabled' : 'enabled'}`,
    `User invocable: ${skill.userInvocable === undefined ? 'not reported' : skill.userInvocable ? 'yes' : 'no'}`,
    describeDisabledBy(skill), '', 'Resources',
    ...(skill.resources?.map((resource) => `${resource.type}: ${resource.name}\n  ${resource.path}`) ?? ['No resources reported.']),
    '', 'Definition content (reported by Droid)', '', skill.content ?? 'Droid did not include the definition body. Use Open definition file to inspect it locally.',
  ].join('\n');
}
