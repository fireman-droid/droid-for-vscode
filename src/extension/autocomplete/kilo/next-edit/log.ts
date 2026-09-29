// Upstream log sites contain only ranges/counts. Routed through the host diagnostics boundary.
let sink: ((message: string) => void) | undefined;
export function setNextEditLogger(value: typeof sink): void { sink = value; }
export function nesLog(message: string): void { sink?.(message); }
