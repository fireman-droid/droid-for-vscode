import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import {
  isValidElement,
  memo,
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

import { highlightCode } from './highlightCode';

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
        {children}
      </pre>
    </div>
  );
}

function HighlightedCode({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement>): React.JSX.Element {
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
        urlTransform={safeMarkdownUrlTransform}
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
      urlTransform={safeMarkdownUrlTransform}
      smooth={TEXT_SMOOTH_OPTIONS}
      defer
    />
  );
});
