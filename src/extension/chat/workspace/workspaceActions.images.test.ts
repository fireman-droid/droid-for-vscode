import { describe, expect, it, vi } from 'vitest';
import type { AttachmentPickOutcome } from '../../attachments/attachmentSources';
import type { WorkspaceActionsPort } from './workspaceActionsPort';
import { handleWorkspaceReadImage } from './workspaceActions';

const url = 'https://images.example.test/plot.png?key=a%2Fb';
const picked: AttachmentPickOutcome = { status: 'picked', items: [{
  kind: 'image', name: 'plot.png', mediaType: 'image/png', data: 'aGk=', sizeBytes: 2, truncated: false,
}] };
function fixture(readRemoteImage = vi.fn<() => Promise<AttachmentPickOutcome>>(async () => picked)) {
  const emit = vi.fn();
  const sessionState = { sessionId: 'session-a' };
  const readWorkspaceFile = vi.fn();
  const port = { emit, sessionState, attachmentSources: { readRemoteImage, readWorkspaceFile },
    getWorkspaceContext: () => ({ cwd: null }),
  } as unknown as WorkspaceActionsPort;
  return { port, emit, sessionState, readRemoteImage, readWorkspaceFile };
}

describe('Markdown remote image resolution', () => {
  it('uses the remote attachment reader without requiring a workspace or changing the URL', async () => {
    const f = fixture();
    handleWorkspaceReadImage(f.port, 'session-a', url);
    await vi.waitFor(() => expect(f.emit).toHaveBeenCalledWith({
      type: 'workspace.imageData', sessionId: 'session-a', path: url,
      status: 'ok', mediaType: 'image/png', data: 'aGk=',
    }));
    expect(f.readRemoteImage).toHaveBeenCalledExactlyOnceWith(url);
    expect(f.readWorkspaceFile).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 'failed' }, 'not-found'],
    [{ status: 'rejected', reason: 'too-large' }, 'too-large'],
    [{ status: 'rejected', reason: 'unsupported-type' }, 'unsupported'],
  ] as const)('reports %j without returning image bytes', async (outcome, status) => {
    const f = fixture(vi.fn(async () => outcome));
    handleWorkspaceReadImage(f.port, 'session-a', url);
    await vi.waitFor(() => expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ path: url, status, data: '', mediaType: null })));
  });

  it('does not emit an old session image after the user switches chats', async () => {
    let complete!: (outcome: AttachmentPickOutcome) => void;
    const f = fixture(vi.fn(() => new Promise(resolve => { complete = resolve; })));
    handleWorkspaceReadImage(f.port, 'session-a', url);
    f.sessionState.sessionId = 'session-b';
    complete(picked);
    await Promise.resolve();
    expect(f.emit).not.toHaveBeenCalled();
    handleWorkspaceReadImage(f.port, 'session-a', url);
    expect(f.readRemoteImage).toHaveBeenCalledOnce();
  });

  it('reports unavailable remote resolution instead of trying the local file reader', () => {
    const f = fixture();
    f.port.attachmentSources.readRemoteImage = undefined;
    handleWorkspaceReadImage(f.port, 'session-a', url);
    expect(f.emit).toHaveBeenCalledWith(expect.objectContaining({ status: 'unsupported' }));
    expect(f.readWorkspaceFile).not.toHaveBeenCalled();
  });
});
