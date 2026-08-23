import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./missionControl.css', import.meta.url), 'utf8');

describe('Mission Control catalog styles', () => {
  it('keeps fixed themes monochrome and Auto boundaries visible', () => {
    expect(css).toMatch(
      /data-dvx-theme-preference='light'[\s\S]*background:\s*#fff/,
    );
    expect(css).toMatch(
      /data-dvx-theme-preference='dark'[\s\S]*background:\s*#000/,
    );
    expect(css).toContain('var(--vscode-panel-border,');
    expect(css).not.toMatch(/#(?:f97316|ff6b00|ff7a00|ea580c)/i);
  });

  it('reflows rows without horizontal overflow at narrow widths', () => {
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toMatch(/\.mission-control-row[\s\S]*min-width:\s*0/);
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/overflow-y:\s*auto/);
  });
});
