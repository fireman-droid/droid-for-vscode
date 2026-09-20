import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { adoptDiagramStyles, reapplyInlineStyles, type MermaidOutcome } from '../markdown/diagramStyles';
import { Button } from '../ui/button';
import { CodeBlock } from './CodeBlock';
import { MarkdownState, useContent } from './context';
import { MediaPreview, type MediaSize } from './MediaPreview';

export function MermaidBlock({ text }: { readonly text: string }) {
  const { streaming } = useContext(MarkdownState);
  const { theme, renderDiagram } = useContent();
  const [outcome, setOutcome] = useState<MermaidOutcome | null>(null);
  const [source, setSource] = useState(false);
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<MediaSize | null>(null);
  useEffect(() => {
    if (streaming || !renderDiagram) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderDiagram(text, theme).then((result) => { if (!cancelled) setOutcome(result); });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, streaming, theme, renderDiagram]);
  if (streaming || outcome?.ok !== true) return <>
    <CodeBlock text={text} language="mermaid" />
    {outcome?.ok === false ? <p role="status" className="text-xs text-muted-foreground">Diagram could not be rendered; showing the source.</p> : null}
  </>;
  return <div className="my-3 space-y-1">
    {source ? <CodeBlock text={text} language="mermaid" /> : <Button variant="plain" size="none" aria-label="Enlarge diagram" className="v2-media-trigger v2-diagram-trigger block w-full overflow-hidden rounded border border-border p-2" onClick={() => setOpen(true)}>
      <DiagramFigure svg={outcome.svg} css={outcome.css} onSize={setSize} />
    </Button>}
    <Button variant="ghost" size="sm" onClick={() => setSource(!source)}>{source ? 'Hide source' : 'View source'}</Button>
    {open ? <MediaPreview label="Diagram preview" size={size} onClose={() => setOpen(false)}><DiagramFigure svg={outcome.svg} css={outcome.css} full /></MediaPreview> : null}
  </div>;
}

function DiagramFigure({ svg, css, full, onSize }: { readonly svg: string; readonly css: string; readonly full?: boolean; readonly onSize?: (size: MediaSize) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = host.current!;
    element.innerHTML = svg;
    reapplyInlineStyles(element);
    const release = adoptDiagramStyles(css);
    const figure = element.querySelector('svg');
    if (figure) {
      const box = figure.viewBox.baseVal;
      onSize?.({ width: box.width || 800, height: box.height || 600 });
      if (full) {
        figure.style.maxWidth = 'none';
        figure.style.width = '100%';
        figure.style.height = '100%';
      }
    }
    return () => { release(); element.replaceChildren(); };
  }, [svg, css, full, onSize]);
  return <div ref={host} role="img" aria-label="Mermaid diagram" className="size-full [&>svg]:max-w-full" />;
}
