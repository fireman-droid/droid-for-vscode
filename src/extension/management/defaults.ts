import * as vscode from 'vscode';
import { parseDefaultSettingsPatch, type DefaultSettingsPatch } from '../../runtime/daemon/defaultSettings';
import { SESSION_AUTONOMY_LEVELS, SESSION_INTERACTION_MODES } from '../../shared/protocol/bounds';
import { changed, choose, confirm, ManagementError, requireSuccess, type ManagementContext } from './managementUi';

export async function manageDefaults(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const defaults = await context.droid.settings.getDefaults();
    const selection = await choose('Droid user defaults and runtime settings', [
      { label: 'Default model', value: 'modelId' as const, description: defaults.modelId ?? 'Droid default' },
      { label: 'Default reasoning', value: 'reasoningEffort' as const, description: defaults.reasoningEffort ?? 'Model default' },
      { label: 'Default mode', value: 'interactionMode' as const, description: defaults.interactionMode ?? 'Droid default' },
      { label: 'Default autonomy', value: 'autonomyLevel' as const, description: defaults.autonomyLevel ?? 'Droid default' },
      { label: 'Cloud session sync', value: 'cloudSessionSync' as const, description: defaults.cloudSessionSync === undefined ? 'Droid default' : defaults.cloudSessionSync ? 'On' : 'Off' },
      { label: 'Run new sessions in worktrees', value: 'runInWorktree' as const, description: defaults.runInWorktree === undefined ? 'Droid default' : defaults.runInWorktree ? 'On' : 'Off' },
      { label: 'Default worktree directory', value: 'worktreeDirectory' as const },
      { label: 'Anthropic 1-hour prompt cache', value: 'enableOneHourAnthropicCaching' as const,
        description: defaults.enableOneHourAnthropicCaching === undefined ? 'Droid default' : defaults.enableOneHourAnthropicCaching ? 'On' : 'Off',
        detail: 'User-wide setting for supported Anthropic requests; provider cache support and pricing apply.' },
      { label: 'Ephemeral worktree retention limit', value: 'worktreeAutoDeleteLimit' as const,
        description: defaults.worktreeAutoDeleteLimit === undefined ? 'Droid default' : String(defaults.worktreeAutoDeleteLimit),
        detail: 'User-wide automatic cleanup budget. Persistent worktrees are excluded; existing ephemeral checkouts may be reclaimed.' },
      { label: 'Advanced defaults…', value: 'advanced' as const, description: 'Spec, compaction, subagent tiers, Mission and worktree settings' },
    ]);
    if (!selection) return;
    let patch: DefaultSettingsPatch | undefined;
    if (selection.value === 'advanced') {
      const raw = await vscode.window.showInputBox({
        title: 'Advanced Droid defaults (JSON patch)',
        prompt: 'Only provided public fields are changed. Examples: specModeModelId, compactionTokenLimit, subagentModelSettings, subagentInheritTiers, subagentAutonomyLevel, missionModelSettings, worktreeDirectory.',
        value: '{}', ignoreFocusOut: true,
        validateInput: (value) => readPatch(value) === null ? 'Enter a non-empty JSON object using supported Droid default fields.' : undefined,
      });
      if (raw === undefined) continue;
      patch = readPatch(raw) ?? undefined;
    } else if (selection.value === 'modelId') {
      const model = await choose('Default model', (defaults.availableModels ?? []).filter((model) => !model.disabledReason).map((model) => ({
        label: model.displayName, description: model.id, id: model.id,
      })));
      if (model) patch = { modelId: model.id };
    } else if (selection.value === 'reasoningEffort') {
      const model = defaults.availableModels?.find((model) => model.id === defaults.modelId);
      const value = await choose('Default reasoning', (model?.supportedReasoningEfforts ?? []).map((value) => ({ label: value, value })));
      if (value) patch = parseDefaultSettingsPatch({ reasoningEffort: value.value }) ?? undefined;
    } else if (selection.value === 'interactionMode' || selection.value === 'autonomyLevel') {
      const values = selection.value === 'interactionMode' ? SESSION_INTERACTION_MODES : SESSION_AUTONOMY_LEVELS;
      const value = await choose(selection.label, values.map((value) => ({ label: value, value })));
      if (value) patch = parseDefaultSettingsPatch({ [selection.value]: value.value }) ?? undefined;
    } else if (selection.value === 'worktreeDirectory') {
      const folder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, title: 'Default worktree parent directory' });
      if (folder?.[0]) patch = { worktreeDirectory: folder[0].fsPath };
    } else if (selection.value === 'worktreeAutoDeleteLimit') {
      const value = await vscode.window.showInputBox({
        title: 'Ephemeral worktree retention limit', value: String(defaults.worktreeAutoDeleteLimit ?? ''),
        prompt: 'Positive whole number; leave empty to restore Droid’s default. Applies to automatic cleanup of user-wide ephemeral worktrees.',
        ignoreFocusOut: true,
        validateInput: (raw) => raw.trim() === '' || /^[1-9]\d*$/.test(raw.trim()) && Number.isSafeInteger(Number(raw))
          ? undefined : 'Enter a positive whole number or leave empty for the Droid default.',
      });
      if (value !== undefined) patch = parseDefaultSettingsPatch({ worktreeAutoDeleteLimit: value.trim() === '' ? null : Number(value) }) ?? undefined;
    } else {
      const value = await choose(selection.label, [{ label: 'Enable', value: true }, { label: 'Disable', value: false }]);
      if (value) patch = { [selection.value]: value.value };
    }
    if (!patch) continue;
    const warning = patch.cloudSessionSync === true
      ? 'Enable cloud session sync? Droid may upload session data to Factory, subject to your account and organization policy.'
      : defaultSettingsConfirmation(patch);
    if (!await confirm(context, warning)) continue;
    const fresh = await context.droid.settings.getDefaults();
    context.assertCurrent(true);
    for (const key of Object.keys(patch)) {
      const policy = fresh.management?.[key as keyof NonNullable<typeof fresh.management>];
      if (policy && 'disabled' in policy && policy.disabled)
        throw new ManagementError(`Droid policy does not allow changing ${key}.`);
      const value = patch[key as keyof DefaultSettingsPatch];
      if (policy && typeof value === 'object' && value !== null && !Array.isArray(value)) {
        for (const child of Object.keys(value)) {
          const nested = (policy as Readonly<Record<string, unknown>>)[child];
          if (nested && typeof nested === 'object' && 'disabled' in nested && nested.disabled)
            throw new ManagementError(`Droid policy does not allow changing ${key}.${child}.`);
        }
      }
    }
    requireSuccess(await context.droid.settings.updateDefaults(patch), 'the defaults update');
    context.assertCurrent();
    await changed('Droid confirmed the user settings update. Session model defaults apply to new sessions; runtime cache and cleanup settings follow Droid’s user-wide configuration. The active chat model was not switched.');
  }
}

function defaultSettingsConfirmation(patch: DefaultSettingsPatch): string {
  const notes: string[] = [];
  if ('enableOneHourAnthropicCaching' in patch) notes.push('Anthropic prompt caching is a user-wide setting for supported requests; cache availability and pricing are controlled by the provider. It does not switch the current model.');
  if ('worktreeAutoDeleteLimit' in patch) notes.push('The ephemeral worktree limit controls Droid’s user-wide automatic cleanup budget, including existing ephemeral worktrees. Persistent worktrees are excluded. Lowering the limit can allow Droid to reclaim older checkouts.');
  return `Change Droid settings: ${Object.keys(patch).join(', ')}?\n${notes.length ? notes.join('\n') : 'Session defaults affect new sessions; the active chat is not switched.'}`;
}

function readPatch(value: string): DefaultSettingsPatch | null {
  if (value.length > 16_384) return null;
  try { return parseDefaultSettingsPatch(JSON.parse(value)); } catch { return null; }
}
