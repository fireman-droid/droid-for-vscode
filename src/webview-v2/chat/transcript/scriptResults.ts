import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import { formatScriptParts, isScriptTool, scriptOutputParts, stripScriptTrailer, scriptBackgroundReceipt, readReceipt, resultText, type ScriptOutputPart } from '../../../shared/transcript/scriptOutput';
import { toolNameCandidates } from '../../../shared/transcript/toolActivity';
import { isToolResultPreview } from '../../../shared/transcript/toolResultPreview';

const commandBody = (text: string) => text.replace(/\r\n?/gu, '\n')
  .replace(/^(?:Error: )?Command failed \(exit code: -?\d+\)\n/u, '')
  .replace(/\n*\[Process exited with code -?\d+\]\s*$/u, '').trim();

function displayedResult(text: string): string {
  if (/^\s*[\[{]/u.test(text)) {
    try { return resultText(JSON.parse(text)); } catch { /* Keep incomplete output verbatim. */ }
  }
  return text;
}

function fileChild(part: ScriptOutputPart, children: readonly ToolTranscriptItem[]): ToolTranscriptItem | undefined {
  const file = part.file?.replaceAll('\\', '/').replace(/^\.\//u, '');
  if (!file || /^(?:\/|[A-Za-z]:)/u.test(file) || file.split('/').includes('..')) return undefined;
  const matches = children.filter(child => {
    const source = child.resultPreview?.source;
    const path = source?.path.replaceAll('\\', '/');
    return toolNameCandidates(child.toolName).includes('read') && source && !source.scope &&
      source.callId === child.toolUseId && (path === file || path?.endsWith('/' + file));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** Presentation only. The canonical transcript and original result stay intact. */
export function presentScriptResults(items: readonly SessionTranscriptItem[]): readonly SessionTranscriptItem[] {
  const childrenByParent = new Map<string, ToolTranscriptItem[]>();
  const displayedChildren = new Map<ToolTranscriptItem, ToolTranscriptItem>();
  for (const item of items) if (item.kind === 'tool' && item.scriptParentId) {
    const children = childrenByParent.get(item.scriptParentId) ?? [];
    children.push(item); childrenByParent.set(item.scriptParentId, children);
  }
  const projected = items.flatMap(item => {
    if (item.kind !== 'tool' || !isScriptTool(item.toolName) || item.status !== 'completed' ||
      item.resultPreview?.availability !== 'available') return [item];
    const preview = item.resultPreview;
    let text = stripScriptTrailer(preview.text);
    const children = childrenByParent.get(item.toolUseId) ?? [];
    const parts = scriptOutputParts(text, preview.truncated);
    const fileChildren = new Map(parts?.map(part => [part, fileChild(part, children)]));
    const fileCounts = new Map<ToolTranscriptItem, number>();
    for (const child of fileChildren.values()) if (child) fileCounts.set(child, (fileCounts.get(child) ?? 0) + 1);
    let transferredPartial = false;
    if (parts) text = formatScriptParts(parts.filter(part => {
      if (part.file !== undefined) {
        const child = fileChildren.get(part);
        const result = child?.resultPreview;
        if (!child || child.status !== 'completed' || child.outputTail || result?.availability !== 'available' || result.truncated ||
          fileCounts.get(child) !== 1) return true;
        if (!part.partial && part.text.trim() === result.text.trim()) return false;
        // The file label only selects an already-linked, trusted Read source. It
        // never creates attribution, reads disk, or restores restricted results.
        const replacement = { ...result, text: part.text, truncated: part.partial === true };
        if (!readReceipt(result.text) || displayedChildren.has(child) || !isToolResultPreview(replacement)) return true;
        displayedChildren.set(child, { ...child, resultPreview: replacement });
        transferredPartial ||= part.partial === true;
        return false;
      }
      return part.partial || part.text.trim() !== 'TODO List Updated' && !children.some(child => {
      const shown = child.outputTail ?? (child.resultPreview?.availability === 'available' ? child.resultPreview.text : child.errorMessage);
      if (!shown || !['completed', 'failed'].includes(child.status)) return false;
      if (part.exitCode !== undefined && (part.exitCode === 0 ? child.status !== 'completed' : child.status !== 'failed')) return false;
      return commandBody(part.text).length > 0 && (commandBody(part.text) === commandBody(shown) ||
        child.resultPreview?.availability === 'available' && !child.resultPreview.truncated &&
        commandBody(part.text) === commandBody(displayedResult(shown)));
      });
    }));
    const background = !preview.truncated ? scriptBackgroundReceipt(text) : undefined;
    if (background && children.some(child => child.status === 'completed' && child.backgroundHint?.fireAndForget &&
      (child.outputTail ?? (child.resultPreview?.availability === 'available' ? child.resultPreview.text : '')).includes(`Background process started (PID: ${background.pid})`))) return [];
    for (const child of parts ? [] : children) {
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
    const fileOutput = parts?.some(part => part.file !== undefined);
    const applied = children.flatMap(child => child.operationDiff?.status === 'ready' && child.operationDiff.source === 'tool-result'
      ? child.operationDiff.files.filter(file => file.outcome === 'applied') : []);
    if (!fileOutput) text = text.replace(/^Success\. Applied changes to the following files:\r?\n(?:[AMD] [^\r\n]+(?:\r?\n|$))+/gmu, receipt => {
      const paths = receipt.trim().split(/\r?\n/u).slice(1);
      return paths.every(line => applied.some(file => {
        const path = line.slice(2).replaceAll('\\', '/');
        const operation = file.kind === 'added' ? 'A' : file.kind === 'deleted' ? 'D' : 'M';
        return line[0] === operation && (path === file.path || path.endsWith('/' + file.path));
      })) ? '' : receipt;
    });
    // TodoWrite already updates the task plan. Keep errors and truncated evidence.
    if (!fileOutput) text = text.replace(/^TODO List Updated\s*$/gmu, '').trim();
    if (!fileOutput && children.some(child => child.detailKind === 'command' && child.status === 'completed' && (child.outputTail || child.resultPreview?.availability === 'available')))
      text = text.replace(/^exit 0\s*$/gmu, '').trim();
    if (!text && (!preview.truncated || transferredPartial)) return [];
    return text === preview.text ? [item] : [{ ...item, resultPreview: { ...preview, text } }];
  });
  return projected.map(item => item.kind === 'tool' ? displayedChildren.get(item) ?? item : item);
}
