// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react';
import type { Root } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { mountWebview } from './mount';
import { reportWebviewRenderError } from './diagnostics';

const mounted = vi.hoisted(() => ({ root: null as Root | null }));
vi.mock('react-dom/client', async importOriginal => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return { ...original, createRoot: (...args: Parameters<typeof original.createRoot>) => {
    mounted.root = original.createRoot(...args); return mounted.root;
  } };
});

it('reports a caught render failure once through the shared beacon and allows retry', async () => {
  const beacon = vi.fn();
  vi.stubGlobal('__dvxBeacon', beacon);
  vi.stubGlobal('__dvxBooted', false);
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = '<div id="root"></div>';
  let fail = true;
  function View() { if (fail) throw new Error('Render failed'); return <p>Recovered</p>; }
  try {
    await act(async () => { mountWebview(<View />, reportWebviewRenderError); });
    expect(beacon).toHaveBeenCalledExactlyOnceWith('error', expect.stringContaining('Render failed'));
    expect((globalThis as { __dvxBooted?: boolean }).__dvxBooted).toBe(true);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered')).toBeTruthy();
    expect(beacon).toHaveBeenCalledOnce();
  } finally {
    act(() => mounted.root?.unmount());
    consoleError.mockRestore(); vi.unstubAllGlobals();
  }
});
