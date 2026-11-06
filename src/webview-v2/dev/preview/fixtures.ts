import type { ManagementSettings } from '../../../shared/protocol/managementPageProtocol';
import type { ReviewScopeState } from '../../../shared/protocol/reviewProtocol';
import type { ReviewRecordedEntry } from '../../../shared/protocol/reviewPanelProtocol';
import type { StudioConfig } from '../studioRuntime';
import { MISSION_CONTROL_PANEL_PROTOCOL_VERSION } from '../../../shared/protocol/missionControlPanelProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../../shared/protocol/missionControlSetupProtocol';

declare const __DVX_VERSION__: string;

export function previewSettings(config: StudioConfig): ManagementSettings {
  return {
    theme: config.theme, resolvedTheme: config.theme === 'light' ? 'light' : 'dark',
    version: typeof __DVX_VERSION__ === 'string' ? __DVX_VERSION__ : 'development',
    cwd: null, connection: 'disconnected', ide: 'unavailable', starfield: 'off',
    completion: {
      enabled: false, fimEnabled: true, nextEdit: {
        enabled: false, endpoint: 'https://example.invalid/edit/completions', model: 'preview-editor',
      },
      autoTrigger: true, relatedFiles: true, adaptiveDebounce: true, debounceMs: 300,
      protocol: 'fim', endpoint: 'https://example.invalid/completions', model: 'preview-completion',
    },
    completionHasKey: false, nextEditHasKey: false, sessionManagementAvailable: true,
    reviewQuestion: { modelId: null, inheritedModelId: 'factory/gpt-5.6', models: [
      { id: 'factory/gpt-5.6', label: 'GPT-5.6', reasoning: ['low', 'medium', 'high'] },
      { id: 'factory/claude-opus-4-6', label: 'Claude Opus 4.6', reasoning: ['low', 'medium', 'high'] },
    ] },
  };
}

export function createMissionSetupPreview(settings: ManagementSettings, sequence: number, task = ''): MissionControlSetupSnapshotMessage {
  const models = settings.reviewQuestion.models;
  const orchestrator = { modelId: models[0]!.id, reasoningEffort: 'high' as const };
  const inherited = { mode: 'same-as-orchestrator' as const, ...orchestrator };
  return {
    type: 'missionControl.setup.snapshot', protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    sequence, setupRevision: 1, workspaceAuthorityRevision: 1, chatOwnerRevision: 1,
    phase: 'draft', availability: 'ready', reason: null, readiness: null,
    draft: { task, orchestrator, worker: inherited, validator: inherited, scrutinyEnabled: true, userTestingEnabled: true },
    capabilities: {
      currentChat: orchestrator, catalogStatus: 'ready',
      catalog: models.map(model => ({ id: model.id, displayName: model.label, isCustom: false,
        supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'high' })),
      preferences: { worker: inherited, validator: inherited, scrutinyEnabled: true, userTestingEnabled: true },
    },
  };
}

export const reviewScope: ReviewScopeState = {
  sessionId: 'preview-review', reviewScopeId: 'preview-scope', scopeKind: 'operations',
  turnId: 'preview-turn', baseline: 'preview-baseline', baselineLabel: 'Fixed preview · recorded edits',
  lifecycle: 'settled', currentIndex: 0, reviewedCount: 0, reviewableCount: 1,
  files: [{ path: 'src/navigation.ts', additions: 2, deletions: 1,
    status: 'unreviewed', version: 'preview-v1', restorable: false }],
};

export const reviewEntries: readonly ReviewRecordedEntry[] = [{
  toolUseId: 'preview-edit', toolName: 'Edit', source: 'tool-result', outcome: 'applied',
  patch: '@@ -1,3 +1,4 @@\n export function openPanel() {\n-  return "chat";\n+  const target = "review";\n+  return target;\n }',
  fullPatch: '@@ -1,3 +1,4 @@\n export function openPanel() {\n-  return "chat";\n+  const target = "review";\n+  return target;\n }',
}];
