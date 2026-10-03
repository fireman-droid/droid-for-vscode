import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const args = process.argv.slice(2);
const prepareAssets = args.includes('--prepare-assets');
const positional = args.filter((arg) => arg !== '--prepare-assets');
assert.ok(positional.length <= 1, 'Expected an optional version tag and --prepare-assets.');
const tag = positional[0] ?? (process.env.RELEASE_TAG || `v${manifest.version}`);
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
if (prepareAssets) {
  const vsix = 'dist/droidvisx.vsix';
  const packaged = JSON.parse(execFileSync('tar', ['-xOf', vsix, 'extension/package.json'], { encoding: 'utf8' }));
  for (const key of ['name', 'publisher', 'version']) {
    assert.equal(packaged[key], manifest[key], `Packaged ${key} differs; rebuild the VSIX first.`);
  }
  const sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8' }).trim().length > 0;
  const assetName = `droidvisx-${manifest.version}.vsix`;
  const sha256 = createHash('sha256').update(readFileSync(vsix)).digest('hex');
  const directory = `dist/release/${tag}`;
  mkdirSync(directory, { recursive: true });
  copyFileSync(vsix, `${directory}/${assetName}`);
  writeFileSync(`${directory}/SHA256SUMS.txt`, `${sha256}  ${assetName}\n`);
  writeFileSync(`${directory}/build-info.json`, JSON.stringify({ ...metadata, sourceDirty, assetName, sha256 }, null, 2) + '\n');
  const notes = [
    `# Droid ${tag}`,
    'Factory Droid CLI 的非官方 VS Code 扩展。需要自行安装并认证 Droid CLI；模型服务另行配置和计费。',
    `下载 ${assetName}，在 Microsoft VS Code 扩展菜单选择 Install from VSIX，然后执行 Developer: Reload Window。`,
    '更新时手动安装新版 VSIX。SHA256SUMS.txt 可用于核对下载文件；Source code 压缩包不能作为扩展安装。',
    `扩展 ID：${extensionId}；VS Code API：${manifest.engines.vscode}。`,
    sourceDirty ? '本地准备包包含未提交改动，不能作为从该提交复现的正式发布包。正式附件应使用版本标签的干净构建。' : `源码提交：${sourceSha}`,
    entry.slice(manifest.version.length).trim(),
  ].join('\n\n') + '\n';
  writeFileSync(`${directory}/RELEASE_NOTES.txt`, notes);
  Object.assign(metadata, { assetName, directory, sha256 });
  console.log(`Prepared ${directory} (sourceDirty=${sourceDirty}).`);
}
console.log(`Release metadata valid: ${extensionId}@${manifest.version} (${sourceSha})`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(metadata).map(([key, value]) => `${key}=${value}\n`).join(''));
}
