// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InlineHtmlPreviewContext,
  LocalImageContext,
  OpenPathContext,
  PathPreviewContext,
} from './MarkdownText';
import { ReadOnlyTranscript } from './ReadOnlyTranscript';

afterEach(cleanup);

describe('ReadOnlyTranscript', () => {
  it('does not inherit main-session path or preview actions', () => {
    const openPath = vi.fn();
    const previewFile = vi.fn();
    const previewHtml = vi.fn();
    const requestImage = vi.fn();
    render(
      <OpenPathContext.Provider value={openPath}>
        <PathPreviewContext.Provider
          value={{
            workspaceRoot: 'D:\\work',
            previewFile,
          }}
        >
          <InlineHtmlPreviewContext.Provider value={previewHtml}>
            <LocalImageContext.Provider
              value={{ entries: {}, request: requestImage }}
            >
              <ReadOnlyTranscript
                items={[
                  {
                    id: 'a1',
                    kind: 'assistant',
                    turnId: 'turn-1',
                    text: [
                      'Read `D:\\work\\src\\index.ts`.',
                      '',
                      '![local](D:\\work\\image.png)',
                      '',
                      '```html',
                      '<main>Preview</main>',
                      '```',
                    ].join('\n'),
                  },
                ]}
                running={false}
              />
            </LocalImageContext.Provider>
          </InlineHtmlPreviewContext.Provider>
        </PathPreviewContext.Provider>
      </OpenPathContext.Provider>,
    );

    expect(
      screen.queryByTitle('Open D:\\work\\src\\index.ts'),
    ).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Open Interactive HTML artifact in Canvas',
      }),
    ).toBeNull();
    expect(openPath).not.toHaveBeenCalled();
    expect(previewFile).not.toHaveBeenCalled();
    expect(previewHtml).not.toHaveBeenCalled();
    expect(requestImage).not.toHaveBeenCalled();
  });

  it('mounts only a window of turns for a long transcript', () => {
    const items = Array.from({ length: 40 }, (_, index) => [
      {
        id: `user-${index}`,
        kind: 'user' as const,
        text: `Question ${index}`,
      },
      {
        id: `assistant-${index}`,
        kind: 'assistant' as const,
        turnId: `turn-${index}`,
        text: `Answer ${index}`,
      },
    ]).flat();
    const { container } = render(
      <ReadOnlyTranscript items={items} running={false} />,
    );
    const mounted = container.querySelectorAll('.dvx-message');
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(items.length);
    expect(screen.getByText('Answer 39')).toBeDefined();
    expect(screen.queryByText('Question 0')).toBeNull();
  });
});
