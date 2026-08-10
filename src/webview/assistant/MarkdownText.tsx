import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import { memo, type AnchorHTMLAttributes } from 'react';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm];
const SAFE_HTTP_URL = /^https?:\/\//iu;

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

export const DroidMarkdownText = memo(function DroidMarkdownText():
  React.JSX.Element {
  return (
    <MarkdownTextPrimitive
      className="dvx-markdown"
      remarkPlugins={REMARK_PLUGINS}
      components={COMPONENTS}
      skipHtml
      urlTransform={safeMarkdownUrlTransform}
      smooth
      defer
    />
  );
});
