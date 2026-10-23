// A token occupies one logical character; its label never leaks into caret offsets.
export function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.dataset.inlineToken) return node.dataset.inlineToken;
  if (node.hasAttribute('data-inline-caret')) return (node.textContent ?? '').replace('\u200b', '');
  // Chromium leaves a trailing BR to keep the caret visible after deletion.
  // Earlier BRs still delimit lines; the final caret filler is not draft text.
  if (node.tagName === 'BR') return node.nextSibling ? '\n' : '';
  return Array.from(node.childNodes, (child, index) => {
    const block = child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName);
    return (block && index > 0 ? '\n' : '') + inlineText(child);
  }).join('');
}

export function inlineSelection(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection();
  const offset = (node: Node | null, position: number) => {
    if (!node || !root.contains(node)) return inlineText(root).length;
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root); range.setEnd(node, position);
    const wrapper = root.ownerDocument.createElement('div'); wrapper.append(range.cloneContents());
    return inlineText(wrapper).length;
  };
  const anchor = offset(selection?.anchorNode ?? null, selection?.anchorOffset ?? 0);
  const focus = offset(selection?.focusNode ?? null, selection?.focusOffset ?? 0);
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: anchor > focus ? 'backward' as const : 'forward' as const };
}

export function setInlineSelection(root: HTMLElement, start: number, end = start, direction = 'forward') {
  const editablePoint = (node: Node, offset: number): [Node, number] | null => {
    if (node.nodeType === Node.TEXT_NODE) return [node, offset];
    if (node instanceof HTMLElement && node.hasAttribute('data-inline-caret') && node.firstChild)
      return [node.firstChild, offset + (node.textContent?.startsWith('\u200b') ? 1 : 0)];
    return null;
  };
  const point = (position: number): [Node, number] => {
    let remaining = Math.max(0, position);
    for (const [index, node] of Array.from(root.childNodes).entries()) {
      const length = inlineText(node).length;
      if (remaining <= length) {
        const editable = editablePoint(node, remaining);
        if (editable) return editable;
        if (remaining === length && node.nextSibling) {
          const after = editablePoint(node.nextSibling, 0);
          if (after) return after;
        }
        return [root, index + (remaining ? 1 : 0)];
      }
      remaining -= length;
    }
    return [root, root.childNodes.length];
  };
  const [startNode, startOffset] = point(start), [endNode, endOffset] = point(end);
  const selection = root.ownerDocument.getSelection();
  if (direction === 'backward') selection?.setBaseAndExtent(endNode, endOffset, startNode, startOffset);
  else selection?.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
}

/** Reveal only the editor's caret; scrollIntoView would also move the chat. */
export function revealInlineCaret(root: HTMLElement) {
  const selection = root.ownerDocument.getSelection();
  if (root.ownerDocument.activeElement !== root || root.clientHeight === 0 ||
    !selection?.focusNode || !root.contains(selection.focusNode)) return;
  const range = root.ownerDocument.createRange();
  range.setStart(selection.focusNode, selection.focusOffset); range.collapse(true);
  let caret = Array.from(range.getClientRects()).find(rect => rect.height > 0);
  // Some engines omit a collapsed rect at the end of a text node.
  if (!caret && selection.focusNode.nodeType === Node.TEXT_NODE && selection.focusOffset > 0) {
    range.setStart(selection.focusNode, selection.focusOffset - 1);
    caret = Array.from(range.getClientRects()).at(-1);
  }
  if (!caret) return;
  const top = root.getBoundingClientRect().top + root.clientTop;
  const bottom = top + root.clientHeight;
  if (caret.bottom > bottom) root.scrollTop += caret.bottom - bottom;
  else if (caret.top < top) root.scrollTop -= top - caret.top;
}
