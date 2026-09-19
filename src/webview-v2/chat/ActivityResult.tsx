import { ActivityResult as ResultView } from '@droidvisx/chat-ui/chat/ActivityResult';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
const labels = { Read: 'Source preview', Grep: 'Matches', Glob: 'Matched paths', LS: 'Directory listing' } as const;
export function ActivityResult({ preview }: { readonly preview: Extract<ToolResultPreview, { availability: 'available' }> }) {
  return <ResultView preview={{ text: preview.text, label: labels[preview.source.tool], truncated: preview.truncated, sourcePath: preview.source.tool === 'Read' ? preview.source.path : undefined }} />;
}
