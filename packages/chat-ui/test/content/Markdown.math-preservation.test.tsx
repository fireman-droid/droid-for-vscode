// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Markdown } from '../../src/content/Markdown';
import { UiEnvironmentProvider } from '../../src/environment';
import { normalizeMathDelimiters } from '../../src/markdown/mathNormalization';
import { parseMarkdown } from '../../src/markdown/parseMarkdown';

afterEach(cleanup);
const literal = String.raw`\(value\) \[array\] $5 and $10`;

describe('math normalization preserves Markdown code', () => {
  it.each([
    ['inline', '`' + literal + '`'],
    ['multi-backtick inline', '``' + literal + ' `inner` ``'],
    ['backtick fence', '```text\n' + literal + '\n```'],
    ['tilde fence', '~~~text\n' + literal + '\n~~~'],
    ['long fence', '````text\n```\n' + literal + '\n````'],
    ['unfinished fence', '```text\n' + literal],
    ['indented block', '    ' + literal],
    ['quoted fence', '> ```text\n> ' + literal + '\n> ```'],
    ['list fence', '- Code:\n\n  ```text\n  ' + literal + '\n  ```'],
  ])('leaves %s unchanged while normalizing adjacent prose', (_kind, source) => {
    expect(normalizeMathDelimiters(source)).toBe(source);
    expect(normalizeMathDelimiters(source + '\n\nFormula: \\(x^2\\).')).toBe(
      source.startsWith('```text') && !source.endsWith('```')
        ? source + '\n\nFormula: \\(x^2\\).'
        : source + '\n\nFormula: $x^2$.',
    );
  });

  it('shows and copies original code while rendering neighboring math', async () => {
    const copyText = vi.fn(async () => {});
    const code = String.raw`const pattern = /\(value\)/;` + '\n';
    const text = 'Formula: \\(x^2\\).\n\n```javascript\n' + code + '```';
    const { container } = render(<UiEnvironmentProvider value={{ assistantName: 'Droid', copyText }}>
      <Markdown text={text} />
    </UiEnvironmentProvider>);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'javascript code' }).textContent).toBe(code);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(code));
  });

  it('uses the same code preservation and math normalization in the worker parser', () => {
    const nodes = parseMarkdown('Formula: \\(x^2\\).\n\n```text\n' + literal + '\n```', false);
    const serialized = JSON.stringify(nodes);
    expect(serialized).toContain('katex');
    expect(serialized).toContain(JSON.stringify(literal + '\n'));
  });
});
