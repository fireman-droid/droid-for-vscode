/** Measure wrapping without collapsing the focused input or its live flex row. */
export function measureComposerInput(row: HTMLElement, input: HTMLTextAreaElement) {
  const shadow = row.cloneNode(true) as HTMLElement;
  shadow.inert = true;
  shadow.setAttribute('aria-hidden', 'true');
  shadow.dataset.multiline = 'false';
  Object.assign(shadow.style, {
    position: 'fixed', top: '0', left: '0', width: `${row.clientWidth}px`,
    height: '0', minHeight: '0', overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none',
  });
  shadow.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  const measured = shadow.querySelector<HTMLTextAreaElement>('[data-composer-input]')!;
  measured.removeAttribute('data-composer-input');
  measured.value = input.value;
  measured.style.height = 'auto';
  measured.style.overflowY = 'hidden';
  row.parentElement!.appendChild(shadow);
  try {
    const style = getComputedStyle(measured);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const parsedMaxHeight = Number.parseFloat(style.maxHeight);
    const maxHeight = Number.isFinite(parsedMaxHeight) ? parsedMaxHeight : Infinity;
    const multiline = input.value.includes('\n') || measured.scrollHeight > Math.ceil(lineHeight);
    shadow.dataset.multiline = String(multiline);
    const contentHeight = measured.scrollHeight;
    const height = Math.min(maxHeight, Math.max(multiline ? lineHeight * 2 : lineHeight, contentHeight));
    return { multiline, height, scrollable: contentHeight > maxHeight };
  } finally {
    shadow.remove();
  }
}
