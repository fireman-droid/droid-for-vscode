import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { scrubCredentials } from '../diagnostics/LocalDiagnostics';

/** Model output stays local. Scrub credentials before splitting so a boundary cannot expose a key. */
export function recordCompletionContent(
  sink: RuntimeDiagnosticSink | undefined, id: number, stage: 'response' | 'candidate', text: string,
): void {
  if (!sink) return;
  const content = scrubCredentials(text);
  const chunkSize = 12_000;
  const parts = Math.max(1, Math.ceil(content.length / chunkSize));
  for (let part = 0; part < parts; part++) {
    sink.record({ level: 'debug', name: 'autocomplete.content',
      attributes: { id, stage, characters: text.length, loggedCharacters: content.length, part: part + 1, parts },
      detail: content.slice(part * chunkSize, (part + 1) * chunkSize) });
  }
}
