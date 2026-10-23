// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FloatingPanel } from '../../src/ui/floating-panel';
import { Textarea } from '../../src/ui/input';
import { TooltipProvider } from '../../src/ui/overlays';

afterEach(cleanup);
const anchor = { getBoundingClientRect: () => ({ left: 40, top: 500 } as DOMRect) };
const panel = (height: number) => <TooltipProvider><FloatingPanel anchor={anchor} title="Code question" onClose={vi.fn()} preferredHeight={height}>
  <Textarea aria-label="Question draft" defaultValue="Explain this code" />
</FloatingPanel></TooltipProvider>;

it('expands the compact composer around its current position without remounting the draft', () => {
  const view = render(panel(132));
  const dialog = screen.getByRole('dialog');
  const compactHeight = Number.parseFloat(dialog.style.height);
  const bottom = Number.parseFloat(dialog.style.top) + compactHeight;
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move question panel' }), { key: 'ArrowRight' });
  const movedLeft = dialog.style.left;
  view.rerender(panel(300));
  expect(Number.parseFloat(dialog.style.height)).toBeGreaterThan(compactHeight);
  expect(Number.parseFloat(dialog.style.top) + Number.parseFloat(dialog.style.height)).toBe(bottom);
  expect(dialog.style.left).toBe(movedLeft);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this code');
});

it('preserves manual dimensions on expansion and position reset', () => {
  const view = render(panel(132));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Resize question panel' }), { key: 'ArrowDown', shiftKey: true });
  const manualHeight = dialog.style.height;
  view.rerender(panel(300));
  expect(dialog.style.height).toBe(manualHeight);
  fireEvent.click(screen.getByRole('button', { name: 'Reset position' }));
  expect(dialog.style.height).toBe(manualHeight);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Explain this code');
});
