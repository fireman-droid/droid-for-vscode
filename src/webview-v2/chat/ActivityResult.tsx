import { ActivityResult as ResultView } from '@droidvisx/chat-ui/chat/ActivityResult';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
const labels = { Read: 'Source preview', Grep: 'Matches', Glob: 'Matched paths', LS: 'Directory listing', WebSearch: 'Web search results', github___get_file_contents: 'Repository content' } as const;
export function ActivityResult({ preview }: { readonly preview: Extract<ToolResultPreview, { availability: 'available' }> }) {
  const sourcePath = preview.source.tool === 'Read' || preview.source.tool === 'github___get_file_contents' ? preview.source.path : undefined;
  return <ResultView preview={{ text: preview.text, label: labels[preview.source.tool], truncated: preview.truncated, sourcePath }} />;
}
