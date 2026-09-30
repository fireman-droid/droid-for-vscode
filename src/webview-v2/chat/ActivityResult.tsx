import { ActivityResult as ResultView } from '@droidvisx/chat-ui/chat/ActivityResult';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
import { toolPresentation } from '../../shared/transcript/toolCatalog';
export function ActivityResult({ preview }: { readonly preview: Extract<ToolResultPreview, { availability: 'available' }> }) {
  const presentation = toolPresentation(preview.source.tool);
  const sourcePath = presentation?.target === 'file' || presentation?.target === 'github'
    ? preview.source.path : undefined;
  return <ResultView preview={{ text: preview.text, label: presentation?.resultLabel ?? 'Tool result', truncated: preview.truncated, sourcePath }} />;
}
