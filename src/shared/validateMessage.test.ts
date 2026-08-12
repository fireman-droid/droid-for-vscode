import { describe, expect, it } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  MAX_ASK_USER_ANSWERS,
  MAX_ASK_USER_ANSWER_LENGTH,
  MAX_ATTACHMENT_TEXT_FILE_CHARS,
  MAX_BRIDGE_ID_LENGTH,
  MAX_EDITED_SPEC_LENGTH,
  MAX_MODEL_ID_LENGTH,
  MAX_OPEN_PATH_LENGTH,
  MAX_OPEN_PATH_POSITION,
  MAX_PERMISSION_OPTION_VALUE_LENGTH,
  MAX_SESSION_SEARCH_QUERY_LENGTH,
  MAX_SESSION_TITLE_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from './bridgeMessages';
import {
  isWebviewToHostMessage,
  parseWebviewMessage,
} from './validateMessage';

describe('parseWebviewMessage', () => {
  it.each([
    {
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    },
    {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'Explain this file.',
    },
    {
      type: 'turn.stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'Ask this instead.',
    },
    {
      type: 'runtime.retry',
      sessionId: null,
    },
    {
      type: 'runtime.retry',
      sessionId: 'session-1',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_edit',
      editedSpecContent: '',
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [{ index: 0, answer: 'Production' }],
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: true,
      answers: [],
    },
    {
      type: 'sessions.refresh',
    },
    {
      type: 'session.select',
      sessionId: 'session-1',
    },
    {
      type: 'session.new',
    },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'Renamed session',
    },
    {
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
    },
    {
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: false,
    },
    {
      type: 'session.archive',
      sessionId: 'session-1',
    },
    {
      type: 'session.unarchive',
      sessionId: 'session-1',
    },
    {
      type: 'sessions.archivedRefresh',
    },
    {
      type: 'session.search',
      query: 'refactor plan',
    },
    {
      type: 'session.search',
      query: 'q'.repeat(MAX_SESSION_SEARCH_QUERY_LENGTH),
    },
    {
      type: 'skills.refresh',
      sessionId: 'session-1',
    },
    {
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 'code-review',
      disabled: true,
    },
    {
      type: 'commands.refresh',
      sessionId: 'session-1',
    },
    {
      type: 'mcp.refresh',
      sessionId: 'session-1',
    },
    {
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'linear',
      enabled: false,
    },
    {
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'linear',
    },
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    },
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'my-server.exe',
    },
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'remote',
      serverType: 'http',
      url: 'https://example.com/mcp',
    },
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'remote-sse',
      serverType: 'sse',
      url: 'http://localhost:3000/sse',
    },
    {
      type: 'mcp.server.remove',
      sessionId: 'session-1',
      name: 'linear',
    },
    {
      type: 'session.compact',
      sessionId: 'session-1',
    },
    {
      type: 'session.fork',
      sessionId: 'session-1',
    },
    {
      type: 'file.openDiff',
      sessionId: 'session-1',
      path: 'src/webview/assistant/App.tsx',
    },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'prototypes/dashboard.html',
    },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'demo.htm',
    },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'design/Landing.HTML',
    },
    {
      type: 'git.requestStatus',
      sessionId: 'session-1',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts', 'docs/notes.md'],
      message: 'feat: add commit panel\n\nvia DroidVisX, 2 files',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'x'.repeat(5000),
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/webview/assistant/App.tsx',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'D:\\E\\前端好玩的东西\\个人简历\\artifacts\\林泽楷-简历.pdf',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: '/home/user/notes.md',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/extension/ChatController.ts',
      line: 42,
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'C:/Users/me/report with spaces.txt',
      line: MAX_OPEN_PATH_POSITION,
      column: 3,
    },
    {
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'file-search-1',
      query: 'Thread',
    },
    {
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'out/plot.png',
    },
    {
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'D:\\reports\\latest chart.png',
    },
    {
      type: 'rewind.info',
      sessionId: 'session-1',
      messageId: 'message-1',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'try again',
      restoreFiles: true,
    },
    {
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: 'src/webview/assistant/Thread.tsx',
    },
    {
      type: 'attachment.pick',
      sessionId: 'session-1',
    },
    {
      type: 'attachment.addEditor',
      sessionId: 'session-1',
    },
    {
      type: 'attachment.addSelection',
      sessionId: 'session-1',
    },
    {
      type: 'attachment.addProblems',
      sessionId: 'session-1',
    },
    {
      type: 'attachment.addGitChanges',
      sessionId: 'session-1',
    },
    {
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: 'attachment-1',
    },
    {
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'screenshot.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
    },
    {
      type: 'attachment.pick',
      sessionId: 'session-1',
      stage: 'edit',
    },
    {
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: 'attachment-1',
      stage: 'edit',
    },
    {
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'screenshot.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
      stage: 'edit',
    },
    {
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['file:///d%3A/repo/src/a.ts', 'file:///d%3A/repo/b.md'],
    },
    {
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['file:///d%3A/repo/src/a.ts'],
      stage: 'edit',
    },
    {
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'dropped file body',
      truncated: false,
    },
    {
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'big.log',
      text: 'partial body',
      truncated: true,
      stage: 'edit',
    },
    {
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'message-1',
    },
    {
      type: 'editStage.cancel',
      sessionId: 'session-1',
    },
    {
      type: 'session.context.refresh',
      sessionId: 'session-1',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'mission',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'model-1',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'xhigh',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 'model-2',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: null,
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeReasoningEffort',
      value: 'low',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeReasoningEffort',
      value: null,
    },
  ])('accepts $type', (message) => {
    expect(parseWebviewMessage(message)).toEqual(message);
    expect(isWebviewToHostMessage(message)).toBe(true);
  });

  it.each([
    null,
    [],
    'turn.send',
    {},
    { type: 'unknown' },
    { type: 'webview.ready', protocolVersion: 1 },
    {
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      extra: true,
    },
    { type: 'turn.send', sessionId: '', turnId: 'turn-1', text: 'Hello' },
    {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: '',
    },
    { type: 'turn.stop', sessionId: 'session-1' },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: '',
      text: 'Ask this instead.',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: '',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'Ask this instead.',
      extra: true,
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'm'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      text: 'Ask this instead.',
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1),
    },
    { type: 'runtime.retry' },
    { type: 'runtime.retry', sessionId: 42 },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: '',
      selectedOption: 'proceed_once',
    },
    {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: '',
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [],
    },
    {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: true,
      answers: [{ index: 0, answer: 'No' }],
    },
    { type: 'sessions.refresh', extra: true },
    { type: 'session.select', sessionId: '' },
    {
      type: 'session.select',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
    },
    { type: 'session.new', sessionId: 'session-1' },
    { type: 'session.rename', sessionId: 'session-1', title: '' },
    { type: 'session.rename', sessionId: 'session-1', title: '   ' },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 't'.repeat(MAX_SESSION_TITLE_LENGTH + 1),
    },
    {
      type: 'session.rename',
      sessionId: 'session-1',
      title: 'Renamed',
      extra: true,
    },
    { type: 'session.rename', sessionId: '', title: 'Renamed' },
    { type: 'session.favorite', sessionId: '', favorite: true },
    { type: 'session.favorite', sessionId: 'session-1' },
    { type: 'session.favorite', sessionId: 'session-1', favorite: 'yes' },
    { type: 'session.favorite', sessionId: 'session-1', favorite: 1 },
    {
      type: 'session.favorite',
      sessionId: 'session-1',
      favorite: true,
      extra: true,
    },
    {
      type: 'session.favorite',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      favorite: true,
    },
    { type: 'session.archive', sessionId: '' },
    { type: 'session.archive' },
    { type: 'session.archive', sessionId: 'session-1', extra: true },
    {
      type: 'session.archive',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
    },
    { type: 'session.unarchive', sessionId: '' },
    { type: 'session.unarchive' },
    { type: 'session.unarchive', sessionId: 'session-1', extra: true },
    { type: 'sessions.archivedRefresh', extra: true },
    { type: 'session.search' },
    { type: 'session.search', query: '' },
    { type: 'session.search', query: '   ' },
    {
      type: 'session.search',
      query: 'q'.repeat(MAX_SESSION_SEARCH_QUERY_LENGTH + 1),
    },
    { type: 'session.search', query: 'line\nbreak' },
    { type: 'session.search', query: 'nul\u0000byte' },
    { type: 'session.search', query: 'ok', extra: true },
    { type: 'session.search', query: 42 },
    { type: 'session.context.refresh', sessionId: '' },
    { type: 'session.compact', sessionId: '' },
    { type: 'session.compact', sessionId: 'session-1', extra: true },
    { type: 'session.fork', sessionId: '' },
    { type: 'session.fork', sessionId: 'session-1', extra: true },
    { type: 'file.openDiff', sessionId: 'session-1', path: '' },
    { type: 'file.openDiff', sessionId: 'session-1', path: '../secrets.env' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'src/../../out.ts' },
    { type: 'file.openDiff', sessionId: 'session-1', path: '/etc/passwd' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'C:/Windows/win.ini' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'src\\app.ts' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'src/\u0000.ts' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'a//b.ts' },
    { type: 'file.openDiff', sessionId: 'session-1', path: 'x'.repeat(513) },
    { type: 'file.openDiff', sessionId: 'session-1' },
    {
      type: 'file.openDiff',
      sessionId: 'session-1',
      path: 'src/a.ts',
      extra: true,
    },
    { type: 'file.preview', sessionId: 'session-1', path: '' },
    { type: 'file.preview', sessionId: '', path: 'proto.html' },
    { type: 'file.preview', sessionId: 'session-1' },
    { type: 'file.preview', sessionId: 'session-1', path: '.html' },
    { type: 'file.preview', sessionId: 'session-1', path: 'src/app.tsx' },
    { type: 'file.preview', sessionId: 'session-1', path: 'proto.html.txt' },
    { type: 'file.preview', sessionId: 'session-1', path: 'proto.js' },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: '../outside/proto.html',
    },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'a/../../proto.html',
    },
    { type: 'file.preview', sessionId: 'session-1', path: '/etc/proto.html' },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'C:/Windows/proto.html',
    },
    { type: 'file.preview', sessionId: 'session-1', path: 'a\\proto.html' },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'a/\u0000proto.html',
    },
    { type: 'file.preview', sessionId: 'session-1', path: 'a//proto.html' },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: `${'x'.repeat(510)}.html`,
    },
    {
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'proto.html',
      extra: true,
    },
    { type: 'git.requestStatus', sessionId: '' },
    { type: 'git.requestStatus' },
    { type: 'git.requestStatus', sessionId: 'session-1', extra: true },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: [],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: '',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: '   \n  ',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'x'.repeat(5001),
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['../outside.ts'],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['/etc/passwd'],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['C:/Windows/win.ini'],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src\\app.ts'],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts', 'src/app.ts'],
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: Array.from(
        { length: 101 },
        (_, index) => `src/file-${index}.ts`,
      ),
      message: 'msg',
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'msg',
      extra: true,
    },
    {
      type: 'git.commit',
      sessionId: 'session-1',
      message: 'msg',
    },
    { type: 'workspace.openPath', sessionId: 'session-1', path: '' },
    { type: 'workspace.openPath', sessionId: 'session-1' },
    { type: 'workspace.openPath', sessionId: '', path: 'src/a.ts' },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: '../outside.env',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'C:\\repo\\..\\secrets.env',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/\u0000.ts',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a\nb.ts',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'x'.repeat(MAX_OPEN_PATH_LENGTH + 1),
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      line: 0,
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      line: 1.5,
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      line: MAX_OPEN_PATH_POSITION + 1,
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      column: 3,
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      line: 1,
      column: '3',
    },
    {
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      extra: true,
    },
    {
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: '',
      query: 'Thread',
    },
    {
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'r-1',
      query: 'x'.repeat(129),
    },
    {
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'r-1',
      query: 'bad\u0000query',
    },
    {
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'r-1',
      query: 'q',
      extra: true,
    },
    { type: 'workspace.readImage', sessionId: 'session-1', path: '' },
    {
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: `${'x'.repeat(1025)}.png`,
    },
    {
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'bad\u0000name.png',
    },
    {
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'a.png',
      extra: true,
    },
    { type: 'rewind.info', sessionId: 'session-1', messageId: '' },
    {
      type: 'rewind.info',
      sessionId: 'session-1',
      messageId: 'message-1',
      extra: true,
    },
    {
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'message-1',
      text: 'try again',
      restoreFiles: 'yes',
    },
    { type: 'attachment.addPath', sessionId: 'session-1', path: '' },
    {
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: '../outside.ts',
    },
    {
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: 'C:/win.ini',
    },
    {
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: 'src/a.ts',
      extra: true,
    },
    {
      // Media type outside the whitelist.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'evil.svg',
      mediaType: 'image/svg+xml',
      dataBase64: 'aW1hZ2U=',
    },
    {
      // Data URI instead of raw base64.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: 'data:image/png;base64,aW1hZ2U=',
    },
    {
      // Mispadded base64 (length % 4 !== 0).
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U',
    },
    {
      // Empty payload.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: '',
    },
    {
      // Payload above the 4 MB base64 cap.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: 'A'.repeat(5_592_412),
    },
    {
      // Control character in the display name.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a\u0000.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
    },
    {
      // Empty name.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: '',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
    },
    {
      // Unexpected extra key.
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
      extra: true,
    },
    {
      // Stage must be the literal 'edit' or absent.
      type: 'attachment.pick',
      sessionId: 'session-1',
      stage: 'composer',
    },
    {
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'a.png',
      mediaType: 'image/png',
      dataBase64: 'aW1hZ2U=',
      stage: null,
    },
    {
      // URI list must not be empty.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: [],
    },
    {
      // Only file:// URIs are accepted.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['https://example.com/a.ts'],
    },
    {
      // One bad entry rejects the whole batch.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['file:///d%3A/repo/a.ts', 'vscode://b.ts'],
    },
    {
      // Above the per-message URI count cap.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: Array.from(
        { length: 9 },
        (_, index) => `file:///d%3A/repo/file-${index}.ts`,
      ),
    },
    {
      // Overlong URI.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: [`file:///${'a'.repeat(2049)}`],
    },
    {
      // Control character in a URI.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['file:///d%3A/repo/a\u0000.ts'],
    },
    {
      // Unexpected extra key.
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: ['file:///d%3A/repo/a.ts'],
      extra: true,
    },
    {
      // Empty text body.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: '',
      truncated: false,
    },
    {
      // Null byte in the text body.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'a\u0000b',
      truncated: false,
    },
    {
      // Text above the char cap.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'a'.repeat(MAX_ATTACHMENT_TEXT_FILE_CHARS + 1),
      truncated: true,
    },
    {
      // Empty name.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: '',
      text: 'body',
      truncated: false,
    },
    {
      // Truncated flag must be a boolean.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'body',
      truncated: 'yes',
    },
    {
      // Unexpected extra key.
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'body',
      truncated: false,
      extra: true,
    },
    { type: 'editStage.begin', sessionId: 'session-1' },
    {
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: '',
    },
    {
      type: 'editStage.cancel',
      sessionId: 'session-1',
      extra: true,
    },
    { type: 'skills.refresh', sessionId: '' },
    { type: 'skills.refresh', sessionId: 'session-1', extra: true },
    { type: 'skill.toggle', sessionId: 'session-1', name: '', disabled: true },
    {
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 's'.repeat(129),
      disabled: true,
    },
    {
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 'code-review',
      disabled: 'yes',
    },
    {
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 'code-review',
    },
    { type: 'commands.refresh', sessionId: '' },
    { type: 'commands.refresh', sessionId: 'session-1', extra: true },
    { type: 'commands.refresh' },
    { type: 'mcp.refresh', sessionId: '' },
    { type: 'mcp.refresh', sessionId: 'session-1', extra: true },
    { type: 'attachment.pick', sessionId: '' },
    { type: 'attachment.pick', sessionId: 'session-1', extra: true },
    { type: 'attachment.addEditor', sessionId: '' },
    { type: 'attachment.addSelection', sessionId: '' },
    { type: 'attachment.addProblems', sessionId: '' },
    {
      type: 'attachment.addProblems',
      sessionId: 'session-1',
      extra: true,
    },
    { type: 'attachment.addGitChanges', sessionId: '' },
    {
      type: 'attachment.addGitChanges',
      sessionId: 'session-1',
      extra: true,
    },
    { type: 'attachment.remove', sessionId: 'session-1' },
    {
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: '',
    },
    {
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: 'a'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
    },
    {
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: '',
      enabled: true,
    },
    {
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'l'.repeat(129),
      enabled: true,
    },
    {
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'linear',
      enabled: 'yes',
    },
    {
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'linear',
    },
    {
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: '',
    },
    {
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'l'.repeat(129),
    },
    {
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'linear',
      extra: true,
    },
    // stdio servers must not carry a URL.
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      url: 'https://example.com',
    },
    // stdio servers require a command.
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
    },
    // http servers must not carry a command.
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'remote',
      serverType: 'http',
      url: 'https://example.com/mcp',
      command: 'npx',
    },
    // URLs must be http(s).
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'remote',
      serverType: 'http',
      url: 'file:///etc/passwd',
    },
    // Unknown server types are rejected.
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'remote',
      serverType: 'websocket',
      url: 'https://example.com/mcp',
    },
    // Args must be non-empty bounded strings.
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: [''],
    },
    {
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['a'.repeat(513)],
    },
    { type: 'mcp.server.remove', sessionId: 'session-1', name: '' },
    {
      type: 'mcp.server.remove',
      sessionId: 'session-1',
      name: 'linear',
      extra: true,
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'agi',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 3,
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'unknown',
      value: 'high',
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 42,
    },
    {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeReasoningEffort',
      value: 'agi',
    },
  ])('rejects malformed input %#', (message) => {
    expect(parseWebviewMessage(message)).toBeUndefined();
    expect(isWebviewToHostMessage(message)).toBe(false);
  });

  it('rejects hostile objects without throwing', () => {
    const message = new Proxy(
      { type: 'turn.stop', sessionId: 'session-1', turnId: 'turn-1' },
      {
        ownKeys() {
          throw new Error('hostile object');
        },
      },
    );

    expect(() => parseWebviewMessage(message)).not.toThrow();
    expect(parseWebviewMessage(message)).toBeUndefined();
  });

  it('rejects symbol-keyed additions to an otherwise exact shape', () => {
    const message = {
      type: 'turn.stop',
      sessionId: 'session-1',
      turnId: 'turn-1',
      [Symbol('hostile-extra')]: true,
    };

    expect(parseWebviewMessage(message)).toBeUndefined();
  });

  it('enforces identifier size boundaries', () => {
    const maximum = {
      type: 'turn.send',
      sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
      turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
      text: 'Prompt',
    };

    expect(parseWebviewMessage(maximum)).toEqual(maximum);
    expect(
      parseWebviewMessage({
        ...maximum,
        sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('accepts a prompt at the exact shared length limit', () => {
    const message = {
      type: 'turn.send',
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'x'.repeat(MAX_TURN_TEXT_LENGTH),
    };

    expect(parseWebviewMessage(message)).toEqual(message);
  });

  it.each([
    ['interactionMode', 'auto'],
    ['interactionMode', 'spec'],
    ['interactionMode', 'mission'],
    ['autonomyLevel', 'off'],
    ['autonomyLevel', 'low'],
    ['autonomyLevel', 'medium'],
    ['autonomyLevel', 'high'],
    ['reasoningEffort', 'none'],
    ['reasoningEffort', 'dynamic'],
    ['reasoningEffort', 'off'],
    ['reasoningEffort', 'minimal'],
    ['reasoningEffort', 'low'],
    ['reasoningEffort', 'medium'],
    ['reasoningEffort', 'high'],
    ['reasoningEffort', 'xhigh'],
    ['reasoningEffort', 'max'],
  ])('accepts legal %s value %s', (field, value) => {
    expect(
      parseWebviewMessage({
        type: 'session.setting.update',
        sessionId: 'session-1',
        field,
        value,
      }),
    ).toBeDefined();
  });

  it('bounds model IDs and rejects hostile setting commands', () => {
    const maximum = {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'm'.repeat(MAX_MODEL_ID_LENGTH),
    };
    expect(parseWebviewMessage(maximum)).toEqual(maximum);
    expect(
      parseWebviewMessage({
        ...maximum,
        value: 'm'.repeat(MAX_MODEL_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        extra: true,
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...maximum,
        [Symbol('extra')]: true,
      }),
    ).toBeUndefined();

    const accessor = {
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      get value() {
        throw new Error('hostile value');
      },
    };
    const proxy = new Proxy(maximum, {
      ownKeys() {
        throw new Error('hostile command');
      },
    });
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });

  it('rejects a prompt one character over the shared length limit', () => {
    expect(
      parseWebviewMessage({
        type: 'turn.send',
        sessionId: 'session-1',
        turnId: 'turn-1',
        text: 'x'.repeat(MAX_TURN_TEXT_LENGTH + 1),
      }),
    ).toBeUndefined();
  });

  it('accepts exact interaction response boundaries', () => {
    expect(
      parseWebviewMessage({
        type: 'permission.respond',
        sessionId: 's'.repeat(MAX_BRIDGE_ID_LENGTH),
        turnId: 't'.repeat(MAX_BRIDGE_ID_LENGTH),
        requestId: 'r'.repeat(MAX_BRIDGE_ID_LENGTH),
        selectedOption: 'o'.repeat(MAX_PERMISSION_OPTION_VALUE_LENGTH),
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH),
      }),
    ).toBeDefined();

    expect(
      parseWebviewMessage({
        type: 'ask-user.respond',
        sessionId: 'session-1',
        turnId: 'turn-1',
        requestId: 'request-1',
        cancelled: false,
        answers: Array.from(
          { length: MAX_ASK_USER_ANSWERS },
          (_, index) => ({
            index:
              index === MAX_ASK_USER_ANSWERS - 1
                ? Number.MAX_SAFE_INTEGER
                : index,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH),
          }),
        ),
      }),
    ).toBeDefined();
  });

  it('rejects over-limit interaction response values', () => {
    const permission = {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
    };
    const askUser = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [{ index: 0, answer: 'Production' }],
    };

    expect(
      parseWebviewMessage({
        ...permission,
        requestId: 'r'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...permission,
        selectedOption: 'o'.repeat(
          MAX_PERMISSION_OPTION_VALUE_LENGTH + 1,
        ),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...permission,
        editedSpecContent: 'e'.repeat(MAX_EDITED_SPEC_LENGTH + 1),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: Array.from(
          { length: MAX_ASK_USER_ANSWERS + 1 },
          (_, index) => ({ index, answer: 'answer' }),
        ),
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: [
          {
            index: 0,
            answer: 'a'.repeat(MAX_ASK_USER_ANSWER_LENGTH + 1),
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...askUser,
        answers: [{ index: Number.MAX_SAFE_INTEGER + 1, answer: 'answer' }],
      }),
    ).toBeUndefined();
  });

  it('rejects duplicate answer indices and nested extras', () => {
    const base = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
    };

    expect(
      parseWebviewMessage({
        ...base,
        answers: [
          { index: 0, answer: 'One' },
          { index: 0, answer: 'Two' },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseWebviewMessage({
        ...base,
        answers: [{ index: 0, answer: 'One', extra: true }],
      }),
    ).toBeUndefined();

    const answers = [{ index: 0, answer: 'One' }];
    Object.defineProperty(answers, 'extra', { value: true });
    expect(parseWebviewMessage({ ...base, answers })).toBeUndefined();

    const sparseAnswers = new Array(1);
    expect(
      parseWebviewMessage({ ...base, answers: sparseAnswers }),
    ).toBeUndefined();
  });

  it('rejects interaction symbols, accessors, and proxies without throwing', () => {
    const symbol = {
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      selectedOption: 'proceed_once',
      [Symbol('extra')]: true,
    };
    const accessor = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: [
        {
          index: 0,
          get answer() {
            throw new Error('hostile answer');
          },
        },
      ],
    };
    const proxy = {
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: 'request-1',
      cancelled: false,
      answers: new Proxy([{ index: 0, answer: 'One' }], {
        ownKeys() {
          throw new Error('hostile answers');
        },
      }),
    };

    expect(parseWebviewMessage(symbol)).toBeUndefined();
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });

  it('rejects hostile session commands without throwing', () => {
    const symbol = {
      type: 'sessions.refresh',
      [Symbol('extra')]: true,
    };
    const accessor = {
      type: 'session.select',
      get sessionId() {
        throw new Error('hostile session id');
      },
    };
    const proxy = new Proxy(
      { type: 'session.new' },
      {
        ownKeys() {
          throw new Error('hostile command');
        },
      },
    );

    expect(parseWebviewMessage(symbol)).toBeUndefined();
    expect(() => parseWebviewMessage(accessor)).not.toThrow();
    expect(parseWebviewMessage(accessor)).toBeUndefined();
    expect(() => parseWebviewMessage(proxy)).not.toThrow();
    expect(parseWebviewMessage(proxy)).toBeUndefined();
  });
});
