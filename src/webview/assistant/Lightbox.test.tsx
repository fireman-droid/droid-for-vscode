// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { DiagramLightbox, readSvgNaturalSize } from './Lightbox';

afterEach(cleanup);

const SVG =
  '<svg viewBox="0 0 400 200" width="100%" ' +
  'style="max-width: 400px;"><rect width="10" height="10"/></svg>';

// jsdom performs no layout; give every div a viewport-like size so the
// fit computation sees a real viewport.
beforeAll(() => {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 800;
    },
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return 600;
    },
  });
});

afterAll(() => {
  delete (HTMLDivElement.prototype as { clientWidth?: number })
    .clientWidth;
  delete (HTMLDivElement.prototype as { clientHeight?: number })
    .clientHeight;
});

describe('readSvgNaturalSize', () => {
  it('reads the viewBox resolution', () => {
    const host = document.createElement('div');
    host.innerHTML = SVG;
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(readSvgNaturalSize(svg)).toEqual({ width: 400, height: 200 });
  });

  it('returns null without a usable viewBox', () => {
    const host = document.createElement('div');
    host.innerHTML = '<svg><rect/></svg>';
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(readSvgNaturalSize(svg)).toBeNull();
  });
});

describe('DiagramLightbox', () => {
  it('mounts the SVG at its natural viewBox size with viewer controls', () => {
    render(<DiagramLightbox svg={SVG} css="" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', {
      name: 'Diagram preview',
    });
    expect(dialog.parentElement).toBe(document.body);
    const figure = screen.getByRole('img', { name: 'Mermaid diagram' });
    const svg = figure.querySelector('svg') as SVGSVGElement;
    // The stage carries the natural resolution; the SVG fills it.
    const stage = figure.parentElement as HTMLElement;
    expect(stage.style.width).toBe('400px');
    expect(stage.style.height).toBe('200px');
    expect(svg.style.maxWidth).toBe('none');
    // The diagram fits inside 800x600, so it opens at 100%.
    expect(screen.getByText('100%')).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Reset zoom to fit' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Zoom to 100%' }),
    ).toBeDefined();
  });

  it('closes on Escape and from the close button', () => {
    const onClose = vi.fn();
    render(<DiagramLightbox svg={SVG} css="" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'Close diagram preview' }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
