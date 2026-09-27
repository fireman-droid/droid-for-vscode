// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeMathDelimiters } from '@droidvisx/chat-ui/markdown/mathNormalization';
import { isInlineHtmlPreviewCandidate, isLocalImagePath, isSafeMarkdownUrl, markdownUrlTransform, previewablePathOf, safeMarkdownUrlTransform } from '@droidvisx/chat-ui/markdown/markdownPolicy';
import { Markdown as MarkdownV2 } from './Markdown';

afterEach(cleanup);

describe.each([['V2', MarkdownV2]] as const)('%s Markdown math', (_version, Content) => {
  it('renders display and inline LaTeX with KaTeX', () => {
    const { container } = render(
      <Content
        text={'答案：\n\n\\[\\boxed{21\\text{颗}}\\]\n\n速度为 \\(v=\\frac{s}{t}\\)。'}
      />,
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.querySelector('.katex .fbox')).not.toBeNull();
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    const visibleMath = Array.from(
      container.querySelectorAll('.katex-html'),
      (node) => node.textContent,
    ).join('');
    expect(visibleMath).not.toContain('\\boxed');
    expect(visibleMath).not.toContain('\\frac');
  });

  it('normalizes model-style delimiters and protects currency', () => {
    expect(normalizeMathDelimiters('\\[x^2\\] and \\(y\\)')).toBe('$$\nx^2\n$$ and $y$');
    expect(normalizeMathDelimiters('$a$ and $$b$$')).toBe('$a$ and $$b$$');
  });

  it('renders inline math without consuming a following currency amount', () => {
    const { container } = render(
      <Content text={'选择 $s_1$，价格是 $5，后面的中文不能变成公式。'} />,
    );

    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(container.textContent).toContain('价格是 $5，后面的中文不能变成公式。');
    expect(container.querySelector('.katex-html')?.textContent).toContain('s1');
  });

  it('promotes array environments to display math', () => {
    const { container } = render(
      <Content
        text={String.raw`结果：$$\begin{array}{c|cc}\text{当前上层}&A&B \\ \hline 1234&2&2 \\ \end{array}$$`}
      />,
    );

    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(container.querySelector('.katex-html')?.textContent).not.toContain(
      '\\begin{array}',
    );
  });

  it('promotes bare LaTeX lines without changing fenced code', () => {
    const { container } = render(
      <Content
        text={[
          String.raw`A=1432,\qquad B=4231.`,
          '',
          String.raw`\operatorname{match}(1234,A)=2,`,
          '',
          String.raw`\begin{array}{c|cc}\text{当前上层}&A&B \\ \hline 1234&2&2 \\ \end{array}`,
          '',
          String.raw`\boxed{x=6}.`,
          '',
          '```tex',
          String.raw`\operatorname{match}(1234,A)=2,`,
          '```',
        ].join('\n')}
      />,
    );

    expect(container.querySelectorAll('.katex-display')).toHaveLength(4);
    expect(container.querySelector('.katex-error')).toBeNull();
    expect(container.querySelector('pre code')?.textContent).toContain(
      '\\operatorname{match}',
    );
  });

  it('normalizes indented display fences before prose and tables', () => {
    const { container } = render(
      <Content
        text={String.raw`2. 将上层第 1,2 个杯子交换，得到
   $$
q=2134,
$$
   再询问一次；

关键是下面这个有限情形表：

| 初始询问 | $2134$ 处询问 | 剩余最多交换次数 |
|---:|---:|---:|
| 4 | 4 | 0 |

$$
\operatorname{match}(1234,A)=2,
$$
因为第 $1,3$ 位匹配；`}
      />,
    );

    expect(container.querySelectorAll('.katex-error')).toHaveLength(0);
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll('p')).some((node) =>
        node.textContent?.includes('\\operatorname'),
      ),
    ).toBe(false);
  });
});

describe('safe Markdown links', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///etc/passwd',
    'command:workbench.action.openSettings',
    'mailto:user@example.com',
    '/relative/path',
  ])('rejects %s', (href) => {
    expect(isSafeMarkdownUrl(href)).toBe(false);
    expect(safeMarkdownUrlTransform(href)).toBe('');
  });

  it('accepts an http documentation URL', () => {
    expect(isSafeMarkdownUrl('http://localhost:3000/docs')).toBe(true);
  });
});

describe('path-link Preview entry', () => {
  const ROOT = 'd:\\E\\前端好玩的东西\\droidvisx';

  const HTML_PATH = 'D:\\E\\前端好玩的东西\\droidvisx\\artifacts\\烟花.html';

  it('resolves previewable workspace paths and refuses the rest', () => {
    const wiring = { workspaceRoot: ROOT, previewFile: vi.fn() };
    expect(previewablePathOf(wiring, { path: HTML_PATH })).toBe('artifacts/烟花.html');
    expect(previewablePathOf(wiring, { path: 'src/demo/a.htm' })).toBe('src/demo/a.htm');
    // Outside the workspace, wrong extension, no wiring, no root.
    expect(previewablePathOf(wiring, { path: 'C:\\Users\\me\\烟花.html' })).toBeNull();
    expect(previewablePathOf(wiring, { path: `${ROOT}\\a.pdf` })).toBeNull();
    expect(previewablePathOf(null, { path: HTML_PATH })).toBeNull();
    expect(
      previewablePathOf(
        { workspaceRoot: null, previewFile: vi.fn() },
        { path: HTML_PATH },
      ),
    ).toBeNull();
  });
});

describe('markdown images', () => {
  it('classifies local image paths without treating schemes as paths', () => {
    expect(isLocalImagePath('out/plot.png')).toBe(true);
    expect(isLocalImagePath('D:\\reports\\chart.jpeg')).toBe(true);
    expect(isLocalImagePath('https://example.com/x.png')).toBe(false);
    expect(isLocalImagePath('javascript:alert(1)')).toBe(false);
    expect(isLocalImagePath('out/notes.txt')).toBe(false);
    // The transform keeps image srcs and still strips link hrefs.
    expect(markdownUrlTransform('out/plot.png', 'src')).toBe('out/plot.png');
    expect(markdownUrlTransform('out/plot.png', 'href')).toBe('');
  });
});

describe('HTML code block preview', () => {
  it('classifies HTML documents with the loose heuristic', () => {
    expect(isInlineHtmlPreviewCandidate('html', '<div>x</div>')).toBe(true);
    expect(isInlineHtmlPreviewCandidate('HTML', '<div>x</div>')).toBe(true);
    expect(isInlineHtmlPreviewCandidate(null, '  <!doctype html><p>x</p>')).toBe(true);
    expect(isInlineHtmlPreviewCandidate(null, '<html lang="en"></html>')).toBe(true);
    expect(isInlineHtmlPreviewCandidate(null, '<div>x</div>')).toBe(false);
    expect(isInlineHtmlPreviewCandidate('js', 'const a = 1;')).toBe(false);
    expect(isInlineHtmlPreviewCandidate('html', '   \n')).toBe(false);
  });
});
