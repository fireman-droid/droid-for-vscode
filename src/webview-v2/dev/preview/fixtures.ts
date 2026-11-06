import type { ManagementSettings } from '../../../shared/protocol/managementPageProtocol';
import type { ReviewScopeState } from '../../../shared/protocol/reviewProtocol';
import type { ReviewRecordedEntry } from '../../../shared/protocol/reviewPanelProtocol';
import type { StudioConfig } from '../studioRuntime';

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
