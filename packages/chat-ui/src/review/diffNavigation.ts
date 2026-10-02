interface ChunkChanges { readonly rows: readonly number[]; readonly count: number }
const changes = new WeakMap<HTMLElement, ChunkChanges>();

export function registerDiffChanges(element: HTMLElement, rows: readonly number[], count: number): () => void {
  changes.set(element, { rows, count });
  return () => { changes.delete(element); };
}

/** Finds an exact change even when its code is outside the rendering window. */
export function findDiffChange(container: HTMLElement, origin: number, direction: number): number | null {
  const chunks = [...container.querySelectorAll<HTMLElement>('[data-diff-changes]')];
  if (direction < 0) chunks.reverse();
  for (const chunk of chunks) {
    const entry = changes.get(chunk);
    if (!entry?.rows.length) continue;
    const rectangle = chunk.getBoundingClientRect();
    const lineHeight = rectangle.height / entry.count;
    if (direction > 0) {
      if (rectangle.top + entry.rows.at(-1)! * lineHeight <= origin) continue;
      const row = entry.rows.find((offset) => rectangle.top + offset * lineHeight > origin);
      if (row !== undefined) return rectangle.top + row * lineHeight;
    } else {
      if (rectangle.top + entry.rows[0]! * lineHeight >= origin) continue;
      for (let index = entry.rows.length - 1; index >= 0; index--) {
        const top = rectangle.top + entry.rows[index]! * lineHeight;
        if (top < origin) return top;
      }
    }
  }
  return null;
}
