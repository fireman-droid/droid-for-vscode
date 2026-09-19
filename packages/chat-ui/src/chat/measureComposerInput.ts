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
  row.parentElement!.appendChild(shadow);
  try {
    const multiline = input.value.length > 0 && (input.value.includes('\n') || measured.scrollHeight > 18);
    shadow.dataset.multiline = String(multiline);
    return { multiline, height: multiline ? Math.min(168, Math.max(36, measured.scrollHeight)) : 18 };
  } finally {
    shadow.remove();
  }
}
