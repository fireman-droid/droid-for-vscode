import { runTests } from '@vscode/test-electron';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDevelopmentPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const integrationRoot = path.join(tmpdir(), 'droidvisx-vscode-integration');
mkdirSync(integrationRoot, { recursive: true });

try {
  await runTests({
    version: '1.108.2',
    platform: 'win32-x64-archive',
    cachePath: path.join(integrationRoot, 'cache'),
    extensionDevelopmentPath,
    extensionTestsPath: path.join(
      extensionDevelopmentPath,
      'src',
      'integration',
      'suite',
      'index.cjs',
    ),
    extensionTestsEnv: {
      FACTORY_API_KEY: undefined,
    },
    launchArgs: [
      '--disable-extensions',
      `--user-data-dir=${path.join(integrationRoot, 'user-data')}`,
      `--extensions-dir=${path.join(integrationRoot, 'extensions')}`,
    ],
  });
} catch (error) {
  console.error('Extension Development Host integration failed.');
  console.error(error);
  process.exitCode = 1;
}
