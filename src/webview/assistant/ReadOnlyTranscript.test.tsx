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
});
