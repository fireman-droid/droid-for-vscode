import { ActivityResult as ResultView } from '@droidvisx/chat-ui/chat/ActivityResult';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
import { toolPresentation } from '../../shared/transcript/toolCatalog';
export function ActivityResult({ preview }: { readonly preview: Extract<ToolResultPreview, { availability: 'available' }> }) {
  const presentation = toolPresentation(preview.source.tool);
  const sourcePath = presentation?.target === 'file' || presentation?.target === 'github'
    ? preview.source.path : undefined;
  const resultLabel = presentation?.resultLabel ?? 'Tool result';
  const label = preview.source.scope === 'external' ? `${resultLabel} · ${preview.source.path}` : resultLabel;
  return <ResultView preview={{ text: preview.text, label, truncated: preview.truncated, sourcePath }} />;
}
