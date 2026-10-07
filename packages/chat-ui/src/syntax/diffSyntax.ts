import { useMemo } from 'react';
import type { InlineDiffLine } from '../review/inlineDiffLines';
import type { DiffSyntaxSource, SyntaxDocument } from './syntaxProtocol';
import { useSyntaxHighlight } from './useSyntaxHighlight';

type Side = 'before' | 'after';
interface Location { document: number; line: number }
export function useDiffSyntax(lines: readonly InlineDiffLine[], path: string, source?: DiffSyntaxSource) {
  const input = useMemo(() => {
    const documents: SyntaxDocument[] = [];
    const locations = new Map<InlineDiffLine, Partial<Record<Side, Location>>>();
    for (const side of ['before', 'after'] as const) {
      const full = source?.[side];
      const sourceLines = full?.split('\n');
      const wanted: number[] = [];
      const fullIndex = documents.length;
      if (full !== undefined) documents.push({ text: full, lines: wanted });
      let fragment: string[] = [];
      const flush = () => {
        if (fragment.length) documents.push({ text: fragment.join('\n') });
        fragment = [];
      };
      for (const line of lines) {
        if (line.kind === 'hunk') { flush(); continue; }
        if (line.kind === 'note' || line.kind === (side === 'before' ? 'add' : 'remove')) continue;
        const number = line[side];
        const exact = number !== null && sourceLines?.[number - 1]?.replace(/\r$/, '') === line.text.replace(/\r$/, '');
        let location: Location;
        if (exact) {
          flush();
          wanted.push(number! - 1);
          location = { document: fullIndex, line: number! - 1 };
        } else {
          location = { document: documents.length, line: fragment.length };
          fragment.push(line.text);
        }
        locations.set(line, { ...locations.get(line), [side]: location });
      }
      flush();
    }
    return { request: { documents, path }, locations };
  }, [lines, path, source]);
  const result = useSyntaxHighlight(input.request);
  return {
    error: result?.error,
    html(line: InlineDiffLine, side: Side): string | undefined {
      const location = input.locations.get(line)?.[side];
      return location && result?.documents[location.document]?.[location.line];
    },
  };
}
