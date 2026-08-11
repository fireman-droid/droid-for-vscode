const assert = require('node:assert/strict');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'droidvisx.droidvisx';
const FOCUS_COMMAND = 'droidvisx.focusView';
const OPEN_LOGS_COMMAND = 'droidvisx.openLogs';
const VIEW_ID = 'droidvisx.chat';

async function run() {
  assert.equal(
    vscode.workspace.workspaceFolders,
    undefined,
    'Integration test must run without a workspace so no Droid runtime starts',
  );

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Expected ${EXTENSION_ID} to be installed`);
  assert.equal(extension.packageJSON.main, './dist/extension/extension.cjs');
  assert.deepEqual(extension.packageJSON.activationEvents, [
    `onView:${VIEW_ID}`,
    `onCommand:${FOCUS_COMMAND}`,
    `onCommand:${OPEN_LOGS_COMMAND}`,
  ]);
  assert.ok(
    extension.packageJSON.contributes.commands.some(
      (entry) => entry.command === FOCUS_COMMAND,
    ),
    'Expected focus command contribution',
  );
  assert.ok(
    extension.packageJSON.contributes.commands.some(
      (entry) => entry.command === OPEN_LOGS_COMMAND,
    ),
    'Expected Open Logs command contribution',
  );
  assert.ok(
    extension.packageJSON.contributes.views.droidvisx.some(
      (entry) => entry.id === VIEW_ID && entry.type === 'webview',
    ),
    'Expected webview view contribution',
  );

  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(FOCUS_COMMAND), 'Focus command was not registered');
  assert.ok(
    commands.includes(OPEN_LOGS_COMMAND),
    'Open Logs command was not registered',
  );
  assert.ok(
    commands.includes(`${VIEW_ID}.focus`),
    'Contributed view focus command was not registered',
  );

  await withTimeout(
    vscode.commands.executeCommand(FOCUS_COMMAND),
    10_000,
    'Focus command timed out',
  );

  const extensionModule = require(path.join(
    extension.extensionPath,
    extension.packageJSON.main,
  ));
  await withTimeout(
    extensionModule.deactivate(),
    10_000,
    'Extension deactivation timed out',
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { run };
