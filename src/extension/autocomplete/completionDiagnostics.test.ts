import { expect, it, vi } from 'vitest';
import { LocalDiagnostics } from '../diagnostics/LocalDiagnostics';
import { recordCompletionContent } from './completionDiagnostics';

it('persists long model output in ordered parts without shortening code or leaking a credential across a boundary', async () => {
  const lines: string[] = [];
  const sink = new LocalDiagnostics({
    directory: 'C:/synthetic-completion-logs',
    output: { appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() },
    fileSystem: {
      mkdir: async () => undefined, readdir: async () => [], stat: async () => ({ size: 0 }),
      appendFile: async (_path, line) => { lines.push(line); }, unlink: async () => undefined,
    },
  });
  const prefix = '// 模型生成的代码\n' + 'x'.repeat(11_975) + '\n';
  const key = 'sk-' + 's'.repeat(40);
  const tail = '\nreturn "unchanged";\n'.repeat(1800);
  recordCompletionContent(sink, 12, 'response', prefix + key + tail);
  await sink.flush();
  const records = lines.map(line => JSON.parse(line));
  expect(records.length).toBeGreaterThan(3);
  expect(records.map(record => record.detail).join('')).toBe(prefix + '[REDACTED]' + tail);
  expect(records.map(record => record.attributes.part)).toEqual(records.map((_record, index) => index + 1));
  expect(records.every(record => record.attributes.id === 12 && record.attributes.parts === records.length)).toBe(true);
  expect(lines.join('')).not.toContain(key);
  sink.dispose();
});
