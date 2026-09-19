import { Fragment, isValidElement, memo, useContext, useDeferredValue, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathDelimiters } from '../markdown/mathNormalization';
import { decodeImagePath, isSafeMarkdownUrl, markdownUrlTransform, previewablePathOf, safeMarkdownUrlTransform } from '../markdown/markdownPolicy';
import { detectPathLink } from '../markdown/pathLink';
import { useLocalImageVisit } from './useLocalImageVisit';
import { CodeBlock } from './CodeBlock';
import { MermaidBlock } from './MermaidBlock';
import { MarkdownState, useContent } from './context';
import { ImageContent } from './MediaPreview';
import { Button, isTextSelectionClick } from '../ui/button';
import { rehypeStreamingText, StreamingSpan, StreamingTextBoundary } from '../chat/streamingText';

const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }] as [typeof remarkMath, { singleDollarTextMath: boolean }]];
const rehypePlugins = [rehypeKatex, rehypeStreamingText];

function SafeLink({ href, children }: ComponentProps<'a'>) {
  return isSafeMarkdownUrl(href) ? <a href={href} target="_blank" rel="noreferrer noopener" draggable={false}
    className="select-text text-link underline-offset-2 hover:underline"
    onClick={(event) => { if (isTextSelectionClick(event)) event.preventDefault(); }}>{children}</a> : <span>{children}</span>;
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function MarkdownPre({ children }: ComponentProps<'pre'>) {
  const { thinking } = useContext(MarkdownState);
  const child = Array.isArray(children) ? children[0] : children;
  const language = isValidElement<{ className?: string }>(child) ? /language-([\w#+-]+)/u.exec(child.props.className ?? '')?.[1] ?? null : null;
  const text = nodeText(children);
  if (thinking) return <pre className="max-w-full overflow-auto rounded bg-muted p-2"><code>{text}</code></pre>;
  return language === 'mermaid' ? <MermaidBlock text={text} /> : <CodeBlock text={text} language={language} />;
}

function InlineCode({ children }: ComponentProps<'code'>) {
  const { actions, workspaceRoot } = useContent();
  const { thinking } = useContext(MarkdownState);
  const path = actions?.openPath && !thinking ? detectPathLink(nodeText(children)) : null;
  const preview = actions?.previewFile && path ? previewablePathOf({ workspaceRoot, previewFile: actions.previewFile }, path) : null;
  return <>
    <code className="v2-inline-code rounded bg-muted px-1 py-0.5 text-[0.92em]">
      {path && actions ? <Button asChild textSelectable variant="plain" size="none" className="text-link hover:underline">
        <a href={`#file:${encodeURIComponent(path.path)}`} draggable={false} className="select-text" title={`Open ${path.path}`}
          onClick={(event) => { event.preventDefault(); if (!isTextSelectionClick(event)) actions.openPath?.(path); }}>
          {nodeText(children).split(/(?<=[\\/])/u).map((segment, index, segments) => <Fragment key={index}>{segment}{index < segments.length - 1 ? <wbr /> : null}</Fragment>)}
        </a>
      </Button> : children}
    </code>
    {preview && actions ? <Button variant="plain" size="none" className="ml-1 rounded border border-border px-1 text-[11px] text-muted-foreground" title={`Open ${preview} in Canvas`} onClick={() => actions.previewFile?.(preview)}>Canvas</Button> : null}
  </>;
}

function MarkdownImage({ src, alt }: ComponentProps<'img'>) {
  const { thinking } = useContext(MarkdownState);
  if (thinking || typeof src !== 'string' || src.length === 0) return null;
  if (isSafeMarkdownUrl(src)) return <img src={src} alt={alt ?? ''} loading="lazy" className="max-h-64 max-w-full rounded object-contain" />;
  return <LocalImage path={decodeImagePath(src)} alt={alt ?? ''} />;
}

function LocalImage({ path, alt }: { readonly path: string; readonly alt: string }) {
  const { images, actions } = useContent();
  const host = useRef<HTMLSpanElement>(null);
  useLocalImageVisit(host, path, images?.request);
  const image = images?.entries[path];
  const link = detectPathLink(path);
  return <span ref={host}>
    {image?.status === 'ok' && image.mediaType !== null
      ? image.data.length === 0 ? <span role="note">Image preview unavailable</span> : <ImageContent src={`data:${image.mediaType};base64,${image.data}`} alt={alt || 'Message image'} />
      : image === undefined && images !== undefined ? <span role="status" className="text-xs text-muted-foreground">Loading image…</span>
        : <span className="text-xs text-muted-foreground">{alt ? `${alt}: ` : ''}{link && actions?.openPath ? <Button textSelectable variant="plain" size="none" className="text-link hover:underline" onClick={() => actions.openPath?.(link)}>{path}</Button> : <code>{path}</code>}{image?.status === 'too-large' ? ' (too large to preview)' : image?.status === 'unsupported' ? ' (not a previewable image)' : ''}</span>}
  </span>;
}

const components: Components = {
  a: SafeLink, pre: MarkdownPre, code: InlineCode, img: MarkdownImage, span: StreamingSpan,
  table: ({ children }) => <div className="v2-markdown-table my-3 max-w-full overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
};

export const Markdown = memo(function Markdown({ text, streaming = false, thinking = false }: {
  readonly text: string;
  readonly streaming?: boolean;
  readonly thinking?: boolean;
}) {
  const normalized = useMemo(() => normalizeMathDelimiters(text), [text]);
  const deferred = useDeferredValue(normalized);
  const [initialLength] = useState(normalized.length);
  const markdownState = useMemo(() => ({ streaming, thinking }), [streaming, thinking]);
  const typography = thinking
    ? 'text-[13px] leading-[1.625] [&_p]:my-1.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:my-2 [&_blockquote]:pl-3 [&_h1]:my-3 [&_h1]:text-base [&_h2]:my-3 [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold'
    : 'markdown-prose';
  return <MarkdownState.Provider value={markdownState}>
    <StreamingTextBoundary initialLength={initialLength} running={streaming}>
    <div className={`markdown-content min-w-0 break-words ${typography} [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} skipHtml urlTransform={thinking ? safeMarkdownUrlTransform : markdownUrlTransform}>{streaming ? deferred : normalized}</ReactMarkdown>
    </div>
    </StreamingTextBoundary>
  </MarkdownState.Provider>;
});
