import { computeEditableRegion } from './kilo/next-edit/editableRegion';
import { MAX_EDITABLE_REGION_LINES } from './kilo/next-edit/constants';
import { getAst } from './kilo/continuedev/core/autocomplete/util/ast';
import { withParserResources } from './kilo/continuedev/core/util/treeSitter';

/** Keep short declarations whole so the model does not reproduce a closing line
 * that is still outside the replacement. Large or incomplete declarations keep
 * the ordinary bounded window; the rest of the file remains read-only context. */
export async function nextEditRegion(filepath: string, text: string, cursorLine: number) {
  const source = text.replace(/\r\n/g, '\n'), totalLines = source.split('\n').length;
  const region = computeEditableRegion({ cursorLine, totalLines });
  if (region.startLine === 0 && region.endLine === totalLines - 1) return region;
  return withParserResources(async () => {
    const tree = await getAst(filepath, source);
    if (!tree) return region;
    let startLine = region.startLine, endLine = region.endLine;
    for (const node of tree.rootNode.namedChildren) {
      if (node.hasError) continue;
      const start = node.startPosition.row;
      const end = node.endPosition.row - Number(node.endPosition.column === 0);
      if (start > region.endLine || end < region.startLine) continue;
      startLine = Math.min(startLine, start); endLine = Math.max(endLine, end);
    }
    return endLine - startLine < MAX_EDITABLE_REGION_LINES ? { startLine, endLine } : region;
  });
}
