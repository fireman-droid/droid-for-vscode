// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { FileDiffPreview } from '@droidvisx/chat-ui/chat/FileDiffPreview';
import { ProcessPresentationProvider } from '@droidvisx/chat-ui/chat/processPresentation';

afterEach(cleanup);

it('keeps per-file expansion across virtual remounts and pauses automatic following', () => {
  const patch = `@@ -0,0 +1,20 @@\n${Array.from({ length: 20 }, (_, index) => `+line-${index}`).join('\n')}`;
  const followingRef = { current: { following: true } };
  function Scene({ visible }: { visible: boolean }) {
    return <ProcessPresentationProvider messageIds={['reply']} followingRef={followingRef}>
      {visible ? ['first.ts', 'second.ts'].map(path => <FileDiffPreview key={path} path={path} patch={patch}
        messageId="reply" disclosureKey={`edit:${path}`} />) : null}
    </ProcessPresentationProvider>;
  }
  const view = render(<Scene visible />);
  fireEvent.click(screen.getByRole('button', { name: 'Show all changes to first.ts' }));
  expect(followingRef.current.following).toBe(false);
  expect(screen.getByRole('region', { name: 'Diff for first.ts' }).textContent).toContain('line-19');
  expect(screen.getByRole('region', { name: 'Diff for second.ts' }).textContent).not.toContain('line-19');
  view.rerender(<Scene visible={false} />);
  view.rerender(<Scene visible />);
  expect(screen.getByRole('button', { name: 'Collapse changes to first.ts' }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'Show all changes to second.ts' }).getAttribute('aria-expanded')).toBe('false');
});
