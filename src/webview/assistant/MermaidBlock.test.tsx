// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentPropsWithoutRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MermaidBlock, MermaidBlockView } from './MermaidBlock';
import { renderMermaid } from './mermaidRenderer';

vi.mock('./mermaidRenderer', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('./mermaidRenderer')>();
  return { ...original, renderMermaid: vi.fn() };
});

const aui = vi.hoisted(() => ({
  state: { message: { status: { type: 'running' } } },
}));

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (state: typeof aui.state) => boolean) =>
    selector(aui.state),
}));

const renderMermaidMock = vi.mocked(renderMermaid);

const Pre = (props: ComponentPropsWithoutRef<'pre'>): React.JSX.Element => (
  <pre {...props} />
);
const Code = (props: ComponentPropsWithoutRef<'code'>): React.JSX.Element => (
  <code {...props} />
);
const components = { Pre, Code };

const OK_OUTCOME = {
  ok: true,
  svg: '<svg id="dvx-mermaid-1"><g class="node"></g></svg>',
  css: '',
} as const;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  renderMermaidMock.mockReset();
  aui.state = { message: { status: { type: 'running' } } };
});

describe('MermaidBlockView', () => {
  it('keeps the code-block form and never parses while streaming', () => {
    render(
      <MermaidBlockView
        code="graph TD; A-->B"
        components={components}
        running
      />,
    );
    expect(screen.getByText('graph TD; A-->B').tagName).toBe('CODE');
    expect(renderMermaidMock).not.toHaveBeenCalled();
  });

  it('renders history replay immediately without a settle delay', async () => {
    renderMermaidMock.mockResolvedValue(OK_OUTCOME);
    const { container } = render(
      <MermaidBlockView
        code="graph TD; A-->B"
        components={components}
        running={false}
      />,
    );
    await waitFor(() =>
      expect(
        container.querySelector('.dvx-mermaid-figure svg'),
      ).not.toBeNull(),
    );
    expect(renderMermaidMock).toHaveBeenCalledTimes(1);
    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD; A-->B');
    expect(container.querySelector('pre')).toBeNull();
  });

  it('parses exactly once after the post-completion drain settles', async () => {
    vi.useFakeTimers();
    renderMermaidMock.mockResolvedValue(OK_OUTCOME);
    const { container, rerender } = render(
      <MermaidBlockView code="graph TD;" components={components} running />,
    );
    rerender(
      <MermaidBlockView
        code="graph TD; A"
        components={components}
        running={false}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    rerender(
      <MermaidBlockView
        code="graph TD; A-->B"
        components={components}
        running={false}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(179);
    });
    expect(renderMermaidMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(renderMermaidMock).toHaveBeenCalledTimes(1);
    expect(renderMermaidMock).toHaveBeenCalledWith('graph TD; A-->B');
    expect(
      container.querySelector('.dvx-mermaid-figure svg'),
    ).not.toBeNull();
  });

  it('falls back to the code block with a quiet note on failure', async () => {
    renderMermaidMock.mockResolvedValue({ ok: false });
    render(
      <MermaidBlockView
        code="graph TD; oops("
        components={components}
        running={false}
      />,
    );
    await screen.findByText(
      'Diagram could not be rendered; showing the source.',
    );
    expect(screen.getByText('graph TD; oops(').tagName).toBe('CODE');
  });

  it('toggles between the diagram and its source', async () => {
    renderMermaidMock.mockResolvedValue(OK_OUTCOME);
    const { container } = render(
      <MermaidBlockView
        code="graph TD; A-->B"
        components={components}
        running={false}
      />,
    );
    const toggle = await screen.findByRole('button', {
      name: 'View source',
    });
    fireEvent.click(toggle);
    expect(screen.getByText('graph TD; A-->B').tagName).toBe('CODE');
    expect(container.querySelector('.dvx-mermaid-figure')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide source' }),
    );
    expect(
      container.querySelector('.dvx-mermaid-figure svg'),
    ).not.toBeNull();
  });
});

describe('MermaidBlock', () => {
  it('derives streaming state from the message status', async () => {
    renderMermaidMock.mockResolvedValue(OK_OUTCOME);
    const { container, rerender } = render(
      <MermaidBlock code="graph TD; A-->B" components={components} />,
    );
    expect(renderMermaidMock).not.toHaveBeenCalled();
    expect(screen.getByText('graph TD; A-->B').tagName).toBe('CODE');
    aui.state = { message: { status: { type: 'complete' } } };
    // Fresh components identity defeats the memo so the mocked
    // useAuiState re-reads the updated status on this rerender.
    rerender(
      <MermaidBlock
        code="graph TD; A-->B"
        components={{ ...components }}
      />,
    );
    await waitFor(() =>
      expect(renderMermaidMock).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        container.querySelector('.dvx-mermaid-figure svg'),
      ).not.toBeNull(),
    );
  });
});
