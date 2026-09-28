import { memo, useMemo } from 'react';
import { highlightCode, type CodeHighlightHints } from '../markdown/highlightCode';

/** Shared token rendering; each surface keeps its existing layout and actions. */
export const CodeSyntax = memo(function CodeSyntax({ text, language, path, detect, streaming = false }: CodeHighlightHints & {
  readonly text: string;
  readonly streaming?: boolean;
}) {
  const html = useMemo(() => streaming ? null : highlightCode(text, { language, path, detect }), [text, language, path, detect, streaming]);
  // Block surfaces own their background; do not inherit host inline-code fills.
  return html === null ? <code className="bg-transparent">{text}</code> : <code className="bg-transparent" dangerouslySetInnerHTML={{ __html: html }} />;
});
