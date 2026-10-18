/** UI feedback is readable by assistive technology, but is not message content. */
export const UI_NOTICE_SELECTOR = '[data-ui-notice],[role="status"],[role="alert"],[role="note"],[data-transcript-selection-exclude]';
const COPY_EXCLUDE = `${UI_NOTICE_SELECTOR},[data-slot="button"]:not([data-text-selectable="true"]):not([data-transcript-selectable]),[data-slot="tooltip-content"],label,[role="menuitem"],[role="option"],[role="tab"],[aria-hidden="true"]`;
const EDITOR = 'input,textarea,[contenteditable]:not([contenteditable="false"])';
const CONTENT = '[data-ui-copy-content]';
const BLOCKS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TR', 'UL']);

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function excluded(element: Element | null): boolean {
  const boundary = element?.closest(`${COPY_EXCLUDE},${CONTENT}`);
  return !!boundary && !boundary.matches(CONTENT);
}

function fragmentText(node: Node, preformatted = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  const element = node instanceof Element ? node : null;
  if (element?.tagName === 'BR') return '\n';
  const pre = preformatted || element?.tagName === 'PRE';
  const content = Array.from(node.childNodes, (child) => fragmentText(child, pre)).join('');
  if (element && (element.tagName === 'TD' || element.tagName === 'TH') && element.nextElementSibling) return `${content}\t`;
  // CSS block spans inside pre retain their line boundary after UI-only nodes
  // are removed from a selection, without changing the rendered source text.
  const block = element?.hasAttribute('data-ui-copy-block') || (!preformatted && element && BLOCKS.has(element.tagName));
  return block && content && !content.endsWith('\n') ? `${content}\n` : content;
}

/** Null preserves native copying; a filtered result omits only selected UI chrome. */
export function filterUiSelection(selection: Selection | null): { text: string; html: string } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const owner = elementOf(range.commonAncestorContainer);
  if (owner?.closest(EDITOR)) return null;
  const blockedOwner = excluded(owner);
  if (!blockedOwner && !Array.from(owner?.querySelectorAll(COPY_EXCLUDE) ?? []).some(node => range.intersectsNode(node))) return null;
  const fragment = range.cloneContents();
  if (blockedOwner) fragment.replaceChildren(...fragment.querySelectorAll(CONTENT));
  const notices = Array.from(fragment.querySelectorAll(COPY_EXCLUDE));
  if (!blockedOwner && !notices.length) return null;
  for (const notice of notices) {
    // A status region may also contain the actual queued question or saved note.
    if (notice.parentElement?.closest(CONTENT)) continue;
    notice.replaceWith(...notice.querySelectorAll(CONTENT));
  }
  const wrapper = document.createElement('div');
  wrapper.append(fragment);
  return { text: fragmentText(wrapper).replace(/^\n+|\n+$/g, ''), html: wrapper.innerHTML };
}

export function selectedContentText(selection: Selection | null): string {
  return filterUiSelection(selection)?.text ?? selection?.toString() ?? '';
}

/** Bubble after editor/Diff copy handlers, preserving their structured payloads. */
export function copyWithoutUiNotices(event: ClipboardEvent): void {
  if (event.defaultPrevented || !event.clipboardData) return;
  if (event.target instanceof Element && event.target.closest(EDITOR)) return;
  const filtered = filterUiSelection(document.getSelection());
  if (filtered === null) return;
  event.preventDefault();
  event.clipboardData.setData('text/plain', filtered.text);
  event.clipboardData.setData('text/html', filtered.html);
}
