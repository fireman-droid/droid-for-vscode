import { useEffect, useState } from 'react';
import type { AttachmentStage } from '../../../shared/bridgeMessages';
import { Markdown } from '../../content/Markdown';
import type { useAttachmentActions } from './useAttachmentActions';
import type { AttachmentPreviewResult } from './attachmentPreview';

export function AttachmentTextPreview({ name, attachmentId, stage, request }: {
  readonly name: string;
  readonly attachmentId?: string;
  readonly stage?: AttachmentStage;
  readonly request?: ReturnType<typeof useAttachmentActions>['handleAttachmentPreview'];
}) {
  const [result, setResult] = useState<AttachmentPreviewResult | null>(null);
  useEffect(() => {
    setResult(null);
    if (!attachmentId || !request) { setResult({ status: 'unavailable' }); return; }
    return request(attachmentId, stage, setResult);
  }, [attachmentId, request, stage]);
  if (result === null) return <p role="status" className="mt-3 text-xs text-muted-foreground">Loading file preview…</p>;
  if (result.status === 'error') return <p role="alert" className="mt-3 text-xs text-destructive">{result.message}</p>;
  if (result.status === 'unavailable') return <p className="mt-3 text-xs text-muted-foreground">The original file content is no longer retained here. Attach the file again to preview it.</p>;
  return <>
    {result.truncated ? <p className="mt-2 shrink-0 text-xs text-muted-foreground">Showing the retained excerpt; the file was truncated.</p> : null}
    <div className="mt-3 min-h-0 overflow-auto border-t border-border pt-3 text-xs" aria-label={`Contents of ${name}`}>
      {result.text.length === 0 ? <p className="text-muted-foreground">Empty file</p>
        : /\.(?:md|markdown)$/iu.test(name) ? <Markdown text={result.text} />
          : <pre className="m-0 whitespace-pre-wrap break-words font-mono">{result.text}</pre>}
    </div>
  </>;
}
