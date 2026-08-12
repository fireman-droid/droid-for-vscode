import { useAuiState } from '@assistant-ui/react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { DiagramLightbox } from './Lightbox';
import {
  adoptDiagramStyles,
  reapplyInlineStyles,
  renderMermaid,
  type MermaidOutcome,
} from './mermaidRenderer';

/**
 * Delay between the last observed source change after a live turn and
 * the (single) mermaid parse. The message status flips to complete
 * while the markdown smooth-commit is still draining (`drainMs` 360 /
 * ~10ms per commit), so debouncing avoids parsing partial source and
 * re-parsing every drain frame. History replay mounts with stable
 * source and renders immediately.
 */
const SETTLE_MS = 180;

/**
 * `componentsByLanguage` renderer for ```mermaid fences. While the
 * message is streaming the block keeps the ordinary code-block form;
 * once the message completes the diagram renders in place, and any
 * failure quietly falls back to the code block with a thin note.
 */
export const MermaidBlock = memo(function MermaidBlock({
  code,
  components,
}: SyntaxHighlighterProps): React.JSX.Element {
  const running = useAuiState(
    (state) => state.message.status?.type === 'running',
  );
  return (
    <MermaidBlockView
      code={code}
      components={components}
      running={running}
    />
  );
});

export function MermaidBlockView({
  code,
  components: { Pre, Code },
  running,
}: {
  readonly code: string;
  readonly components: SyntaxHighlighterProps['components'];
  readonly running: boolean;
}): React.JSX.Element {
  const sawStreamingRef = useRef(running);
  if (running) {
    sawStreamingRef.current = true;
  }
  const [settled, setSettled] = useState<string | null>(
    running ? null : code,
  );
  const [outcome, setOutcome] = useState<MermaidOutcome | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    if (running) {
      return undefined;
    }
    if (!sawStreamingRef.current) {
      setSettled(code);
      return undefined;
    }
    const timer = setTimeout(() => setSettled(code), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [running, code]);

  useEffect(() => {
    if (settled === null) {
      return undefined;
    }
    let cancelled = false;
    void renderMermaid(settled).then((result) => {
      if (!cancelled) {
        setOutcome(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [settled]);

  const sourceBlock = (
    <Pre>
      <Code>{code}</Code>
    </Pre>
  );

  if (outcome?.ok === true) {
    return (
      <div className="dvx-mermaid">
        {showSource ? (
          sourceBlock
        ) : (
          <button
            type="button"
            className="dvx-mermaid-zoom"
            title="Click to enlarge"
            aria-label="Enlarge diagram"
            onClick={() => setEnlarged(true)}
          >
            <MermaidFigure svg={outcome.svg} css={outcome.css} />
          </button>
        )}
        <div className="dvx-mermaid-footer">
          <button
            type="button"
            className="dvx-mermaid-toggle"
            onClick={() => setShowSource((visible) => !visible)}
          >
            {showSource ? 'Hide source' : 'View source'}
          </button>
        </div>
        {enlarged && !showSource ? (
          <DiagramLightbox
            svg={outcome.svg}
            css={outcome.css}
            onClose={() => setEnlarged(false)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="dvx-mermaid">
      {sourceBlock}
      {outcome !== null && !outcome.ok ? (
        <p className="dvx-mermaid-note">
          Diagram could not be rendered; showing the source.
        </p>
      ) : null}
    </div>
  );
}

function MermaidFigure({
  svg,
  css,
}: {
  readonly svg: string;
  readonly css: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    host.innerHTML = svg;
    reapplyInlineStyles(host);
    const release = adoptDiagramStyles(css);
    return () => {
      release();
      host.replaceChildren();
    };
  }, [svg, css]);
  return (
    <div
      ref={hostRef}
      className="dvx-mermaid-figure"
      role="img"
      aria-label="Mermaid diagram"
    />
  );
}
