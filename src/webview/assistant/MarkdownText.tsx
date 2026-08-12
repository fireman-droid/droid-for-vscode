import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  createContext,
  isValidElement,
  memo,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { MAX_IMAGE_PATH_LENGTH } from '../../shared/bridgeMessages';
import { highlightCode } from './highlightCode';
import { detectPathLink, type PathLink } from './pathLink';
import type { LocalImageEntry } from './store';
import { TranscriptImage } from './TranscriptImage';

/**
 * Receives the path the user clicked in transcript inline code. The
 * app provides it once at the root; a null default keeps standalone
 * markdown renders (tests, panels without wiring) inert.
 */
export type OpenPathHandler = (link: PathLink) => void;
export const OpenPathContext =
  createContext<OpenPathHandler | null>(null);

/**
 * True inside a fenced code block. Distinguishes inline code (path
 * links allowed) from block code, which react-markdown renders
 * through the same `code` component.
 */
const InsidePreContext = createContext(false);

const REMARK_PLUGINS = [remarkGfm];
const SAFE_HTTP_URL = /^https?:\/\//iu;
const TEXT_SMOOTH_OPTIONS = {
  drainMs: 360,
  maxCharIntervalMs: 10,
  maxCharsPerFrame: 18,
  minCommitMs: 40,
} as const;

export function isSafeMarkdownUrl(url: string | undefined): url is string {
  return typeof url === 'string' && SAFE_HTTP_URL.test(url);
}

export function safeMarkdownUrlTransform(url: string): string {
  return isSafeMarkdownUrl(url) ? url : '';
}

/**
 * Workspace-local images resolved over the Bridge, keyed by the path
 * exactly as written in the markdown source. The app provides it at
 * the root; a null default keeps standalone renders (tests, panels
 * without wiring) on the plain path-link fallback.
 */
export interface LocalImageSource {
  readonly entries: Readonly<Record<string, LocalImageEntry>>;
  readonly request: (path: string) => void;
}
export const LocalImageContext =
  createContext<LocalImageSource | null>(null);

const LOCAL_IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp)$/iu;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const WINDOWS_DRIVE = /^[a-z]:[\\/]/iu;

/**
 * True for plausible file-system references to a displayable image.
 * Everything with a real URL scheme is excluded (a Windows drive
 * prefix like `d:\` is not a scheme); the string is only ever used
 * as a lookup key and Bridge payload, never as a URI.
 */
export function isLocalImagePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_IMAGE_PATH_LENGTH) {
    return false;
  }
  if (URL_SCHEME.test(value) && !WINDOWS_DRIVE.test(value)) {
    return false;
  }
  return LOCAL_IMAGE_EXTENSION.test(value);
}

/**
 * Keeps http(s) URLs everywhere and additionally lets local image
 * paths through for `src`, where the img component resolves them via
 * the host instead of using them as a URI.
 */
export function markdownUrlTransform(url: string, key: string): string {
  if (key === 'src' && isLocalImagePath(url)) {
    return url;
  }
  return safeMarkdownUrlTransform(url);
}

/** Markdown percent-encodes spaces and CJK in URLs; file paths on
 * disk are not encoded, so decode before asking the host. */
function decodeImagePath(src: string): string {
  let path = src;
  try {
    path = decodeURIComponent(src);
  } catch {
    // Keep the raw string when it is not valid percent-encoding.
  }
  return path.startsWith('./') ? path.slice(2) : path;
}

function MarkdownImage({
  src,
  alt,
}: {
  readonly src?: string | Blob;
  readonly alt?: string;
}): React.JSX.Element | null {
  if (typeof src !== 'string' || src.length === 0) {
    return null;
  }
  if (isSafeMarkdownUrl(src)) {
    return (
      <img
        className="dvx-markdown-image"
        src={src}
        alt={alt ?? ''}
        loading="lazy"
      />
    );
  }
  return <LocalMarkdownImage path={decodeImagePath(src)} alt={alt} />;
}

function LocalMarkdownImage({
  path,
  alt,
}: {
  readonly path: string;
  readonly alt?: string;
}): React.JSX.Element {
  const source = useContext(LocalImageContext);
  const entry = source?.entries[path];
  const request = source?.request;
  useEffect(() => {
    if (request !== undefined && entry === undefined) {
      request(path);
    }
  }, [request, entry, path]);
  if (entry?.status === 'ok' && entry.mediaType !== null) {
    // Reuse the transcript image presentation: bounded thumbnail plus
    // the zoom/pan lightbox.
    return (
      <TranscriptImage
        data={{
          mediaType: entry.mediaType,
          data: entry.data,
          generated: false,
          byteLength: Math.floor((entry.data.length * 3) / 4),
        }}
      />
    );
  }
  if (source !== null && entry === undefined) {
    return (
      <span className="dvx-markdown-image-pending" role="status">
        Loading image…
      </span>
    );
  }
  // The bytes are unavailable (no workspace wiring, missing file,
  // oversized, or not an image after all): degrade to the same
  // clickable path affordance used for inline code.
  return <MarkdownImageFallback path={path} alt={alt} entry={entry} />;
}

function MarkdownImageFallback({
  path,
  alt,
  entry,
}: {
  readonly path: string;
  readonly alt?: string;
  readonly entry: LocalImageEntry | undefined;
}): React.JSX.Element {
  const openPath = useContext(OpenPathContext);
  const label = alt !== undefined && alt.length > 0 ? `${alt} — ` : '';
  const reason =
    entry?.status === 'too-large'
      ? ' (too large to preview)'
      : entry?.status === 'unsupported'
        ? ' (not a previewable image)'
        : '';
  const pathLink = detectPathLink(path);
  if (openPath !== null && pathLink !== null) {
    return (
      <span className="dvx-markdown-image-fallback">
        {label}
        <button
          type="button"
          className="dvx-path-link"
          title={`Open ${pathLink.path}`}
          onClick={() => openPath(pathLink)}
        >
          {path}
        </button>
        {reason}
      </span>
    );
  }
  return (
    <span className="dvx-markdown-image-fallback">
      {label}
      <code>{path}</code>
      {reason}
    </span>
  );
}

export function SafeLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>): React.JSX.Element {
  if (!isSafeMarkdownUrl(href)) {
    return <span>{children}</span>;
  }
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => {
        if (!isSafeMarkdownUrl(event.currentTarget.href)) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </a>
  );
}

function readCodeLanguage(className: string | undefined): string | null {
  const match = /language-([\w#+-]+)/u.exec(className ?? '');
  return match?.[1] ?? null;
}

function readNodeText(node: ReactNode): string {
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(readNodeText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return readNodeText(node.props.children);
  }
  return '';
}

function CodeBlock({
  children,
  ...props
}: HTMLAttributes<HTMLPreElement>): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  useLayoutEffect(() => {
    setLanguage(
      readCodeLanguage(
        preRef.current?.querySelector('code')?.className ?? undefined,
      ),
    );
  });
  const copy = (): void => {
    const text = preRef.current?.innerText ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="dvx-code-block">
      <div className="dvx-code-block-header">
        <span className="dvx-code-block-language">{language ?? 'text'}</span>
        <button
          type="button"
          className="dvx-code-block-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
        >
          {copied ? <CodeCheckIcon /> : <CodeCopyIcon />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre ref={preRef} {...props}>
        <InsidePreContext.Provider value={true}>
          {children}
        </InsidePreContext.Provider>
      </pre>
    </div>
  );
}

function HighlightedCode({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>): React.JSX.Element {
  const insidePre = useContext(InsidePreContext);
  const openPath = useContext(OpenPathContext);
  const language = readCodeLanguage(className);
  const text = useMemo(
    () => (language === null ? '' : readNodeText(children)),
    [children, language],
  );
  const html = useMemo(
    () =>
      language === null || text.length === 0
        ? null
        : highlightCode(text, language),
    [language, text],
  );
  if (html === null) {
    const pathLink =
      insidePre || language !== null || openPath === null
        ? null
        : detectPathLink(readNodeText(children));
    if (pathLink !== null && openPath !== null) {
      return (
        <code className={className} {...props}>
          <button
            type="button"
            className="dvx-path-link"
            title={`Open ${pathLink.path}`}
            onClick={() => openPath(pathLink)}
          >
            {children}
          </button>
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
  return (
    <code
      className={className}
      {...props}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function CodeCopyIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect
        x="4.5"
        y="4.5"
        width="6"
        height="6"
        rx="1"
        stroke="currentColor"
      />
      <path
        d="M3 9.5H2.75A1.25 1.25 0 0 1 1.5 8.25v-5.5A1.25 1.25 0 0 1 2.75 1.5h5.5A1.25 1.25 0 0 1 9.5 2.75V3"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CodeCheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="m3.25 7.25 2.35 2.35L10.75 4.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const COMPONENTS = {
  a: SafeLink,
  pre: CodeBlock,
  code: HighlightedCode,
  img: MarkdownImage,
};

export const DroidMarkdownContent = memo(function DroidMarkdownContent({
  text,
  className = 'dvx-markdown',
}: {
  readonly text: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        components={COMPONENTS}
        skipHtml
        urlTransform={markdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

export const DroidMarkdownText = memo(function DroidMarkdownText():
  React.JSX.Element {
  return (
    <MarkdownTextPrimitive
      className="dvx-markdown"
      remarkPlugins={REMARK_PLUGINS}
      components={COMPONENTS}
      skipHtml
      urlTransform={markdownUrlTransform}
      smooth={TEXT_SMOOTH_OPTIONS}
      defer
    />
  );
});
