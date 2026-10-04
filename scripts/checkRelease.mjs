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

const changelog = readFileSync('CHANGELOG.md', 'utf8').replaceAll('\r\n', '\n');
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
  const assetName = `droid-${manifest.version}.vsix`;
  const sha256 = createHash('sha256').update(readFileSync(vsix)).digest('hex');
  const directory = `dist/release/${tag}`;
  mkdirSync(directory, { recursive: true });
  copyFileSync(vsix, `${directory}/${assetName}`);
  writeFileSync(`${directory}/SHA256SUMS.txt`, `${sha256}  ${assetName}\n`);
  writeFileSync(`${directory}/build-info.json`, JSON.stringify({ ...metadata, sourceDirty, assetName, sha256 }, null, 2) + '\n');
  const highlights = entry.split(/^### /mu).find((section) => section.startsWith('Highlights\n'));
  const notes = [
    '在 VS Code / Cursor 中使用 Droid：聊天、审阅代码改动、继续编写代码。Factory Droid CLI 的非官方图形界面。',
    ...(highlights ? ['## 版本亮点', highlights.slice('Highlights\n'.length).trim()] : []),
    '## 安装',
    `1. 在下方 **Assets** 下载 **\`${assetName}\`**。\n2. 打开编辑器扩展面板的 **… → Install from VSIX…**，选择下载的文件。\n3. 执行 **Developer: Reload Window**，再运行 **Droid: Open Chat**。`,
    `需要支持 VS Code API \`${manifest.engines.vscode}\` 的编辑器，以及已安装并认证的 [Droid CLI](https://docs.factory.ai/droid-cli/quickstart.md)。模型服务单独配置和计费；代码补全需另行启用。`,
    '更新时直接安装新版 VSIX，无需卸载旧版。Source code 压缩包用于查看源码，不能作为扩展安装。',
    '[使用文档](https://github.com/fireman-droid/droid-for-vscode#readme) · [问题反馈](https://github.com/fireman-droid/droid-for-vscode/issues)',
    '<details>\n<summary>完整更新记录</summary>\n',
    entry.slice(manifest.version.length).trim(),
    '</details>',
    '<details>\n<summary>版本与校验信息</summary>\n',
    `- 扩展 ID：\`${extensionId}\`（保持不变）。\n- 源码提交：\`${sourceSha}\`。\n- 下载校验：\`Get-FileHash .\\${assetName} -Algorithm SHA256\`，与 \`SHA256SUMS.txt\` 对照。`,
    ...(sourceDirty ? ['本地准备包包含未提交改动；正式附件需从版本标签的干净源码构建。'] : []),
    '</details>',
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
