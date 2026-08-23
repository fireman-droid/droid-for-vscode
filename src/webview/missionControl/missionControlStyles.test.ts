import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./missionControl.css', import.meta.url), 'utf8');

describe('Mission Control catalog styles', () => {
  it('pins every approved fixed Light and Dark token', () => {
    expect(readBlock("html[data-dvx-theme-preference='light']")).toContain(
      [
        '--mission-bg: #fff;',
        '--mission-fg: #111;',
        '--mission-muted: #606060;',
        '--mission-border: #d4d4d4;',
        '--mission-hover: #f6f6f6;',
        '--mission-focus: #303030;',
        'background: #fff;',
      ].join('\n'),
    );
    expect(readBlock("html[data-dvx-theme-preference='dark']")).toContain(
      [
        '--mission-bg: #000;',
        '--mission-fg: #f4f4f4;',
        '--mission-muted: #a0a0a0;',
        '--mission-border: #333;',
        '--mission-hover: #111;',
        '--mission-focus: #d0d0d0;',
        'background: #000;',
      ].join('\n'),
    );
    expect(css).not.toMatch(/#(?:f97316|ff6b00|ff7a00|ea580c)/i);
  });

  it('retains editor-native Auto tokens with visible fallbacks', () => {
    const auto = readBlock(':root');
    expect(auto).toContain(
      '--mission-bg: var(--vscode-editor-background, #fff);',
    );
    expect(auto).toContain(
      '--mission-fg: var(--vscode-editor-foreground, #1f1f1f);',
    );
    expect(auto).toContain(
      '--mission-muted: var(--vscode-descriptionForeground, #666);',
    );
    expect(auto).toContain(
      '--mission-border: var(--vscode-panel-border, #b8b8b8);',
    );
    expect(auto).toContain(
      '--mission-hover: var(--vscode-list-hoverBackground, rgb(127 127 127 / 10%));',
    );
    expect(auto).toContain(
      '--mission-focus: var(--vscode-focusBorder, #646464);',
    );
  });

  it('reflows before desktop tracks, gaps, padding, and row sizing can clip', () => {
    const desktopMinimum =
      220 + 120 + 110 + 90 + 100 + 4 * 18 + 2 * 40 + 2 * 14;
    expect(desktopMinimum).toBe(820);
    expect(css).toContain('@media (max-width: 819px)');
    expect(css).toMatch(
      /\.mission-control-columns\s*\{\s*box-sizing:\s*border-box;/,
    );
    expect(css).toMatch(
      /\.mission-control-row\s*\{\s*box-sizing:\s*border-box;/,
    );
    expect(css).toMatch(/\.mission-control-row[\s\S]*min-width:\s*0/);
    expect(css).toMatch(/overflow-x:\s*hidden/);
    expect(css).toMatch(/overflow-y:\s*auto/);
  });
});

function readBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [
    ...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g')),
  ];
  const match = matches.at(-1);
  expect(match, `Missing CSS block for ${selector}`).not.toBeNull();
  return match![1]!
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}
