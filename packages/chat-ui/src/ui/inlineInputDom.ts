// A token occupies one logical character; its label never leaks into caret offsets.
export function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return '';
  if (node.dataset.inlineToken) return node.dataset.inlineToken;
  if (node.tagName === 'BR') return '\n';
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
  const point = (position: number): [Node, number] => {
    let remaining = Math.max(0, position);
    for (const [index, node] of Array.from(root.childNodes).entries()) {
      const length = inlineText(node).length;
      if (remaining <= length) {
        if (node.nodeType === Node.TEXT_NODE) return [node, remaining];
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
