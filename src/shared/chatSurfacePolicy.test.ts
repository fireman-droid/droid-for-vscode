import { expect, it } from 'vitest';
import { isChatSurfaceCommandAllowed } from './chatSurfacePolicy';

it.each([
  { type: 'session.new' }, { type: 'session.select' }, { type: 'session.fork' },
  { type: 'worktree.createSession' }, { type: 'session.compact' }, { type: 'turn.editResend' },
  { type: 'rewind.info' }, { type: 'editStage.begin' }, { type: 'editStage.cancel' },
  { type: 'mission.start' }, { type: 'missionControl.navigate' },
  { type: 'session.setting.update', field: 'interactionMode', value: 'mission' },
])('keeps $type under main chat ownership', (command) => {
  expect(isChatSurfaceCommandAllowed('main', command)).toBe(true);
  expect(isChatSurfaceCommandAllowed('child', command)).toBe(false);
});

it.each([
  { type: 'turn.send' }, { type: 'turn.stop' }, { type: 'permission.respond' },
  { type: 'ask-user.respond' }, { type: 'runtime.retry' },
  { type: 'session.setting.update', field: 'interactionMode', value: 'auto' },
  { type: 'session.setting.update', field: 'modelId', value: 'chosen-model' },
])('allows ordinary child conversation action $type', (command) => {
  expect(isChatSurfaceCommandAllowed('child', command)).toBe(true);
});
