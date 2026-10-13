// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('restores the live theme before the app loads and caches later theme changes', async () => {
  const html = readFileSync('src/webview-v2/dev/index.html', 'utf8');
  const bootstrap = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (!bootstrap) throw new Error('The browser theme bootstrap is missing.');
  window.history.replaceState(null, '', '/live?view=management');
  sessionStorage.setItem('dvx.browser-dev.theme', JSON.stringify({ preference: 'light', resolved: 'light' }));
  const root = document.documentElement;
  root.dataset.dvxTheme = 'dark';
  root.dataset.dvxThemePreference = 'dark';

  // Run only the parser-time bootstrap: no React app or Host response exists yet.
  window.eval(bootstrap);
  expect(root.dataset.theme).toBe('light');
  expect(root.dataset.themePreference).toBe('light');
  expect(root.dataset.dvxTheme).toBe('light');
  expect(root.dataset.dvxThemePreference).toBe('light');

  // The live Host can correct the hint; the next reload uses that latest pair.
  root.dataset.theme = 'dark';
  root.dataset.themePreference = 'auto';
  await Promise.resolve();
  expect(JSON.parse(sessionStorage.getItem('dvx.browser-dev.theme')!))
    .toEqual({ preference: 'auto', resolved: 'dark' });
});
