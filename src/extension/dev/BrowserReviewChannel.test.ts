import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import { BrowserReviewChannel } from './BrowserReviewChannel';

function response() {
  const events = new EventEmitter();
  return Object.assign(events, { destroyed: false, writeHead: vi.fn(), write: vi.fn(), end: vi.fn() });
}

it('routes Review messages and releases the old controller without letting its close event detach a new stream', () => {
  const controllers: Array<{ post: (message: unknown) => void; open: ReturnType<typeof vi.fn>; handleMessage: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
  const channel = new BrowserReviewChannel(post => {
    const controller = { post, open: vi.fn(), handleMessage: vi.fn(), dispose: vi.fn() };
    controllers.push(controller);
    return controller;
  });
  const first = response();
  channel.connect(first as unknown as ServerResponse);
  expect(controllers[0]!.open).toHaveBeenCalledOnce();
  channel.handleMessage({ type: 'reviewPanel.ready' });
  expect(controllers[0]!.handleMessage).toHaveBeenCalledWith({ type: 'reviewPanel.ready' });
  controllers[0]!.post({ type: 'reviewPanel.context' });
  expect(first.write).toHaveBeenLastCalledWith('data: {"type":"reviewPanel.context"}\n\n');
  const second = response();
  channel.connect(second as unknown as ServerResponse);
  expect(controllers[0]!.dispose).toHaveBeenCalledOnce();
  first.emit('close');
  controllers[0]!.post({ type: 'late' });
  expect(second.write).toHaveBeenCalledTimes(1);
  channel.handleMessage({ type: 'reviewPanel.gitStatus' });
  expect(controllers[1]!.handleMessage).toHaveBeenCalledWith({ type: 'reviewPanel.gitStatus' });
  second.emit('close');
  expect(controllers[1]!.dispose).toHaveBeenCalledOnce();
  channel.dispose();
  expect(controllers[1]!.dispose).toHaveBeenCalledOnce();
});
