/** Measure wrapping without collapsing the focused input or its live flex row. */
export function measureComposerInput(row: HTMLElement, input: HTMLTextAreaElement, expanded = false) {
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
  // Height is capped: lay out only enough text to reach the cap. The live input
  // keeps the complete value; laying out a second full draft is unnecessary.
  const text = input.value;
  let measuredLength = Math.min(text.length, 256);
  measured.value = text.slice(0, measuredLength);
  measured.style.height = 'auto';
  measured.style.overflowY = 'hidden';
  row.parentElement!.appendChild(shadow);
  try {
    const style = getComputedStyle(measured);
    const lineHeight = Number.parseFloat(style.lineHeight) || 20;
    const parsedMaxHeight = Number.parseFloat(style.maxHeight);
    const maxHeight = Number.isFinite(parsedMaxHeight) ? parsedMaxHeight : Infinity;
    const measureUntil = (limit: number) => {
      let contentHeight = measured.scrollHeight;
      while (contentHeight <= limit && measuredLength < text.length) {
        measuredLength = Math.min(text.length, measuredLength * 4);
        measured.value = text.slice(0, measuredLength);
        contentHeight = measured.scrollHeight;
      }
      return contentHeight;
    };
    const multiline = expanded || text.includes('\n') || measureUntil(Math.ceil(lineHeight)) > Math.ceil(lineHeight);
    shadow.dataset.multiline = String(multiline);
    const contentHeight = measureUntil(maxHeight);
    const height = Math.min(maxHeight, Math.max(multiline ? lineHeight * 2 : lineHeight, contentHeight));
    return { multiline, height, scrollable: contentHeight > maxHeight };
  } finally {
    shadow.remove();
  }
}
