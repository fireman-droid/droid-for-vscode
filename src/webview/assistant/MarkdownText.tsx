import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { memo, type AnchorHTMLAttributes } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

const COMPONENTS = { a: SafeLink };

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
