import type { ClipboardEvent } from 'react';
import { useUiEnvironment } from '../environment';
import { useContent } from '../content/context';
import { CODE_REFERENCE_MIME, readCodeReference } from '../chat/codeReferences';
import { readDiffSelection } from './diffQuestion';
import type { DiffRow } from './DiffView';
import type { InlineDiffLine } from './inlineDiffLines';

export function useDiffCodeCopy(path: string, rows: readonly DiffRow[] | null, lines: readonly InlineDiffLine[]) {
  const { codeReferencePath } = useUiEnvironment();
  const { workspaceRoot } = useContent();
  return (event: ClipboardEvent<HTMLDivElement>) => {
    const captured = readDiffSelection(event.currentTarget, path, rows, lines);
    if (!captured) return;
    const selected = captured.selection;
    event.clipboardData.setData('text/plain', selected.text);
    const absolute = codeReferencePath?.(path) ?? (/^(?:[a-z]:[\\/]|\/)/i.test(path) || !workspaceRoot
      ? path : `${workspaceRoot.replace(/[\\/]$/, '')}/${path}`);
    const reference = readCodeReference({ ...selected, path: absolute });
    // Recorded excerpts without absolute line numbers remain ordinary code.
    if (reference && captured.contiguous) event.clipboardData.setData(CODE_REFERENCE_MIME, JSON.stringify(reference));
    event.preventDefault();
  };
}
