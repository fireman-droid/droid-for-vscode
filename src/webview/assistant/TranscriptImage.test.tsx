// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranscriptImage } from './TranscriptImage';

afterEach(cleanup);

// 1x1 transparent PNG.
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const imageData = {
  mediaType: 'image/png',
  data: PIXEL,
  generated: false,
  byteLength: 68,
};

/** Opens the lightbox and simulates the image finishing its load at a
 * given natural resolution inside a given viewport. The zoom/pan
 * transform rides the stage element wrapping the image. */
async function openLightbox(options: {
  naturalWidth: number;
  naturalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}): Promise<{
  dialog: HTMLElement;
  stage: HTMLElement;
  img: HTMLImageElement;
}> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Enlarge image/ }));
  const dialog = screen.getByRole('dialog', { name: 'Image preview' });
  Object.defineProperty(dialog, 'clientWidth', {
    value: options.viewportWidth,
  });
  Object.defineProperty(dialog, 'clientHeight', {
    value: options.viewportHeight,
  });
  const img = screen.getByAltText('Full size image') as HTMLImageElement;
  const stage = img.parentElement as HTMLElement;
  Object.defineProperty(img, 'naturalWidth', {
    value: options.naturalWidth,
  });
  Object.defineProperty(img, 'naturalHeight', {
    value: options.naturalHeight,
  });
  // jsdom has no pointer capture; the pan handlers call these.
  stage.setPointerCapture = () => undefined;
  stage.releasePointerCapture = () => undefined;
  fireEvent.load(img);
  return { dialog, stage, img };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

describe('TranscriptImage', () => {
  it('shows a visible close button in the lightbox and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<TranscriptImage data={imageData} />);
    await user.click(
      screen.getByRole('button', { name: /Enlarge image/ }),
    );
    // The overlay mounts on document.body so no transformed transcript
    // ancestor can become its containing block and clip the button.
    const dialog = screen.getByRole('dialog', { name: 'Image preview' });
    expect(dialog.parentElement).toBe(document.body);
    expect(
      screen.getByRole('button', { name: 'Close image preview' }),
    ).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not bubble the enlarge click to a wrapping editor surface', () => {
    const onOuter = vi.fn();
    render(
      <button type="button" onClick={onOuter}>
        <TranscriptImage data={imageData} />
      </button>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Enlarge image/ }));
    expect(onOuter).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeDefined();
  });

  it('closes from the backdrop without clicking through to the transcript', () => {
    const onOuter = vi.fn();
    render(
      <button type="button" onClick={onOuter}>
        <TranscriptImage data={imageData} />
      </button>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Enlarge image/ }));
    const dialog = screen.getByRole('dialog', { name: 'Image preview' });
    fireEvent.pointerDown(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
    const leaked = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(leaked);
    expect(leaked.defaultPrevented).toBe(true);
    expect(onOuter).not.toHaveBeenCalled();
  });

  it('closes from the close button without bubbling to the backdrop', async () => {
    const user = userEvent.setup();
    render(<TranscriptImage data={imageData} />);
    await user.click(
      screen.getByRole('button', { name: /Enlarge image/ }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Close image preview' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts at the fit scale and reports it in the zoom indicator', async () => {
    render(<TranscriptImage data={imageData} />);
    await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    // fit = min(1, (800-48)/2000, (600-48)/1000) = 0.376 → 38%.
    expect(screen.getByText('38%')).toBeDefined();
  });

  it('zooms with the wheel anchored math and clamps at the bounds', async () => {
    render(<TranscriptImage data={imageData} />);
    const { dialog } = await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    fireEvent.wheel(dialog, { deltaY: -100, clientX: 400, clientY: 300 });
    const raised = Number(
      screen.getByText(/%$/).textContent?.replace('%', ''),
    );
    expect(raised).toBeGreaterThan(38);
    for (let step = 0; step < 60; step += 1) {
      fireEvent.wheel(dialog, { deltaY: 400, clientX: 400, clientY: 300 });
    }
    expect(screen.getByText('25%')).toBeDefined();
    for (let step = 0; step < 120; step += 1) {
      fireEvent.wheel(dialog, {
        deltaY: -400,
        clientX: 400,
        clientY: 300,
      });
    }
    expect(screen.getByText('800%')).toBeDefined();
  });

  it('treats ctrl+wheel (touchpad pinch) as zoom too', async () => {
    render(<TranscriptImage data={imageData} />);
    const { dialog } = await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    fireEvent.wheel(dialog, {
      deltaY: -20,
      ctrlKey: true,
      clientX: 400,
      clientY: 300,
    });
    const percent = Number(
      screen.getByText(/%$/).textContent?.replace('%', ''),
    );
    expect(percent).toBeGreaterThan(38);
  });

  it('double-click toggles between fit and 100% and back', async () => {
    render(<TranscriptImage data={imageData} />);
    const { stage } = await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    fireEvent.doubleClick(stage, { clientX: 400, clientY: 300 });
    expect(screen.getByText('100%')).toBeDefined();
    fireEvent.doubleClick(stage, { clientX: 400, clientY: 300 });
    expect(screen.getByText('38%')).toBeDefined();
  });

  it('offers explicit Reset and 1:1 controls next to close', async () => {
    render(<TranscriptImage data={imageData} />);
    await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to 100%' }));
    expect(screen.getByText('100%')).toBeDefined();
    fireEvent.click(
      screen.getByRole('button', { name: 'Reset zoom to fit' }),
    );
    expect(screen.getByText('38%')).toBeDefined();
    // Neither control closes the viewer.
    expect(
      screen.getByRole('dialog', { name: 'Image preview' }),
    ).toBeDefined();
  });

  it('pans by dragging once magnified past fit', async () => {
    render(<TranscriptImage data={imageData} />);
    const { stage } = await openLightbox({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 800,
      viewportHeight: 600,
    });
    fireEvent.doubleClick(stage, { clientX: 400, clientY: 300 });
    expect(stage.className).toContain('dvx-image-grab');
    fireEvent.pointerDown(stage, {
      button: 0,
      pointerId: 1,
      clientX: 400,
      clientY: 300,
    });
    expect(stage.className).toContain('dvx-image-grabbing');
    fireEvent.pointerMove(stage, {
      pointerId: 1,
      clientX: 440,
      clientY: 320,
    });
    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(stage.className).not.toContain('dvx-image-grabbing');
    await nextFrame();
    expect(stage.style.transform).toContain('translate(');
    expect(stage.style.transform).not.toContain('translate(0px, 0px)');
  });

  it('renders a placeholder row when the image bytes were dropped', () => {
    render(
      <TranscriptImage
        data={{ ...imageData, data: '', byteLength: 2_500_000 }}
      />,
    );
    expect(screen.getByRole('note').textContent).toContain(
      'preview unavailable',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
