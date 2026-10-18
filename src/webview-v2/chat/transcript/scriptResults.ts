import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import { isScriptTool, stripScriptTrailer } from '../../../shared/transcript/scriptOutput';

/** Presentation only. The canonical transcript and original result stay intact. */
export function presentScriptResults(items: readonly SessionTranscriptItem[]): readonly SessionTranscriptItem[] {
  const childrenByParent = new Map<string, ToolTranscriptItem[]>();
  for (const item of items) if (item.kind === 'tool' && item.scriptParentId) {
    const children = childrenByParent.get(item.scriptParentId) ?? [];
    children.push(item); childrenByParent.set(item.scriptParentId, children);
  }
  return items.flatMap(item => {
    if (item.kind !== 'tool' || !isScriptTool(item.toolName) || item.status !== 'completed' ||
      item.resultPreview?.availability !== 'available') return [item];
    const preview = item.resultPreview;
    let text = stripScriptTrailer(preview.text);
    const children = childrenByParent.get(item.toolUseId) ?? [];
    for (const child of children) {
      if (child.status !== 'completed') continue;
      const shown = child.outputTail ?? (child.resultPreview?.availability === 'available' ? child.resultPreview.text : undefined);
      if (!shown) continue;
      const body = shown.replace(/\r\n?/gu, '\n').replace(/\n*\[Process exited with code \d+\]\s*$/u, '').trim();
      if (!body) continue;
      // Match complete lines, not a substring of unrelated Script prose.
      const wrapped = '\n' + text.replace(/\r\n?/gu, '\n').trim() + '\n';
      const index = wrapped.indexOf('\n' + body + '\n');
      if (index !== -1) text = (wrapped.slice(0, index) + '\n' + wrapped.slice(index + body.length + 2)).trim();
    }
    const applied = children.flatMap(child => child.operationDiff?.status === 'ready' && child.operationDiff.source === 'tool-result'
      ? child.operationDiff.files.filter(file => file.outcome === 'applied') : []);
    text = text.replace(/^Success\. Applied changes to the following files:\r?\n(?:[AMD] [^\r\n]+(?:\r?\n|$))+/gmu, receipt => {
      const paths = receipt.trim().split(/\r?\n/u).slice(1);
      return paths.every(line => applied.some(file => {
        const path = line.slice(2).replaceAll('\\', '/');
        const operation = file.kind === 'added' ? 'A' : file.kind === 'deleted' ? 'D' : 'M';
        return line[0] === operation && (path === file.path || path.endsWith('/' + file.path));
      })) ? '' : receipt;
    });
    // TodoWrite already updates the task plan. Keep errors and truncated evidence.
    text = text.replace(/^TODO List Updated\s*$/gmu, '').trim();
    if (children.some(child => child.detailKind === 'command' && child.status === 'completed' && (child.outputTail || child.resultPreview?.availability === 'available')))
      text = text.replace(/^exit 0\s*$/gmu, '').trim();
    if (!text && !preview.truncated) return [];
    return text === preview.text ? [item] : [{ ...item, resultPreview: { ...preview, text } }];
  });
}
