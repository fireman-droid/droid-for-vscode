import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('./styles/23-interaction-dock.css', import.meta.url),
  'utf8',
);
const shellCss = readFileSync(
  new URL('./styles/10-shell-frame.css', import.meta.url),
  'utf8',
);

function declarations(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? '';
}

describe('interaction dock layout', () => {
  it('keeps the Composer footer outside the transcript scroll row', () => {
    expect(shellCss).toMatch(
      /\.dvx-thread\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/s,
    );
    expect(shellCss).toMatch(
      /\.dvx-thread-viewport\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/s,
    );
  });

  it('scrolls only AskUser questions and keeps actions outside the scroller', () => {
    expect(
      declarations('.dvx-thread-footer > .dvx-interaction-panel'),
    ).toContain('display: flex');
    expect(
      declarations('.dvx-thread-footer .dvx-interaction-card'),
    ).toContain('overflow: hidden');
    expect(
      declarations('.dvx-thread-footer .dvx-ask-questions'),
    ).toContain('overflow-y: auto');
    const actions = declarations(
      '.dvx-thread-footer .dvx-interaction-actions',
    );
    expect(actions).toContain('flex: none');
    expect(actions).toContain('height: auto');
    expect(actions).toContain('min-height: 56px');
    expect(actions).toContain('padding: 11px 0 12px');
    expect(
      declarations('.dvx-thread-footer .dvx-plan-preview'),
    ).toContain('max-height: min(34vh, 340px)');
  });
});
