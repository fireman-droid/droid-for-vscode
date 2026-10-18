import { scrubCredentialAssignments } from '../../shared/validation/presentationSafety';
import { isScriptTool, readReceipt, readableScriptOutput } from '../../shared/transcript/scriptOutput';
import { useI18n } from '@droidvisx/chat-ui/i18n';
import { ActivityResult as ResultView } from '@droidvisx/chat-ui/chat/ActivityResult';
import type { ToolResultPreview } from '../../shared/transcript/toolResultPreview';
import { toolPresentation } from '../../shared/transcript/toolCatalog';
export function ActivityResult({ preview }: { readonly preview: Extract<ToolResultPreview, { availability: 'available' }> }) {
  const { t } = useI18n();
  const presentation = toolPresentation(preview.source.tool);
  const text = isScriptTool(preview.source.tool) ? scrubCredentialAssignments(readableScriptOutput(preview.text)) : preview.text;
  const receipt = presentation?.target === 'file' && !preview.truncated ? readReceipt(preview.text) : undefined;
  if (receipt) return <p className="text-[11px] text-muted-foreground">{t('Read lines {start}–{end} ({size})', receipt)}</p>;
  const sourcePath = presentation?.target === 'file' || presentation?.target === 'github'
    ? preview.source.path : undefined;
  const resultLabel = t(presentation?.resultLabel ?? 'Tool result');
  const label = preview.source.scope === 'external' ? `${resultLabel} · ${preview.source.path}` : resultLabel;
  return <ResultView preview={{ text, label, truncated: preview.truncated, sourcePath }} />;
}
