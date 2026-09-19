// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { ImageContent } from './MediaPreview';

afterEach(cleanup);

it('closes an enlarged image with Escape and restores focus to its thumbnail', async () => {
  const user = userEvent.setup();
  render(<ImageContent src="data:image/png;base64,iVBORw0KGgo=" alt="Synthetic image" />);
  const thumbnail = screen.getByRole('button', { name: 'Enlarge Synthetic image' });
  await user.click(thumbnail);
  await screen.findByRole('dialog', { name: 'Image preview' });
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(thumbnail);
  });
});
