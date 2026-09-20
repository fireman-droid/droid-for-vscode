import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.argv[2] ?? (process.env.RELEASE_TAG || `v${manifest.version}`);
assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u,
  'Release tag must be a stable version such as v0.8.1.');
assert.equal(tag, `v${manifest.version}`, 'Release tag must match package.json version.');

const changelog = readFileSync('CHANGELOG.md', 'utf8');
const entry = changelog.split(/^## /mu).find((section) => section.split(/\r?\n/u)[0] === manifest.version);
assert.ok(entry?.slice(manifest.version.length).trim(),
  `CHANGELOG.md must contain a nonempty "## ${manifest.version}" release entry.`);

const extensionId = `${manifest.publisher}.${manifest.name}`;
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const metadata = { tag, version: manifest.version, extensionId, sourceSha };
console.log(`Release metadata valid: ${extensionId}@${manifest.version} (${sourceSha})`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
}
