// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { StagedImagePreview } from './StagedImagePreview';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '../../shared/bridgeMessages';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('preserves annotation after an oversized encode and saves the replacement only after a valid encode', async () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementationOnce((callback) => callback(new Blob([new Uint8Array(MAX_ATTACHMENT_IMAGE_BYTES + 1)], { type: 'image/png' })))
    .mockImplementationOnce((callback) => callback(new Blob(['annotated'], { type: 'image/png' })));
  const user = userEvent.setup();
  const save = vi.fn();
  const close = vi.fn();
  render(<StagedImagePreview name="shot.png" data="dGVzdA==" mediaType="image/png" onSave={save} onClose={close} />);
  const image = screen.getByRole('img', { name: 'shot.png' });
  Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
  fireEvent.load(image);
  const canvas = screen.getByLabelText('Image annotation canvas');
  Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => false });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  fireEvent.pointerDown(canvas, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { clientX: 30, clientY: 25 });
  fireEvent.pointerUp(canvas, { clientX: 30, clientY: 25 });
  await user.click(screen.getByRole('button', { name: 'Save annotation' }));
  expect(await screen.findByText('Annotated image exceeds the 4 MB attachment limit.')).toBeDefined();
  expect(save).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save annotation' }));
  await waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(btoa('annotated'), 'image/png'));
  expect(close).toHaveBeenCalledOnce();
});
