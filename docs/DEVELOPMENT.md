# 开发与发布

[返回项目首页](../README.md) · [全部文档](README.md)

## 环境

建议先复用已验证的 Windows 环境：

- Git，以及用于只读查看分发包内容的 `tar`。
- 建议 Node.js 24 LTS。历史干净目录验证使用 `24.13.1`；
  本轮构建环境和实际验证结果以 [当前状态](STATUS.md) 为准。
- pnpm `10.2.0`，与 `package.json` 的 `packageManager` 一致。
  未安装时可执行 `npm install --global pnpm@10.2.0`。
- Cursor 或 VS Code；扩展要求 VS Code API `^1.108.0`。
- 运行真实会话还需官方 Droid CLI；已验证版本见 [当前状态](STATUS.md)，不保证所有 CLI 版本兼容。
  通过 [官方 CLI 快速开始](https://docs.factory.ai/droid-cli/quickstart.md) 安装并完成本机认证；
  BYOK 参考 [官方配置说明](https://docs.factory.ai/model-independence/byok.md)。
  先在新电脑终端确认 `droid --version`，并能正常使用所选模型。

源码可放在自己的工作目录。macOS/Linux 未进行本次干净安装验证。

## 拉取与安装依赖

首次克隆：

```powershell
git clone https://github.com/fireman-droid/droid-for-vscode.git
cd droid-for-vscode
pnpm install --frozen-lockfile
```

已有工作副本时，先检查 `git status` 并保存自己的改动，然后在仓库目录执行
`git pull --ff-only` 和 `pnpm install --frozen-lockfile`。
不要通过删除 lockfile 或更新依赖来处理环境差异。

## 构建、打包并安装最新源码

```powershell
pnpm run package:vsix
pnpm run verify:vsix
code --install-extension dist/droidvisx.vsix --force
```

确认 `code` 来自 Microsoft VS Code；Cursor 使用
`cursor --install-extension dist/droidvisx.vsix --force`。如果编辑器命令不在 PATH，也可通过扩展面板的
**Install from VSIX** 选择生成文件。
随后执行 **Developer: Reload Window**。

`package:vsix` 的 `vscode:prepublish` 会串行执行 typecheck、文件预算检查、
独立 UI 构建和 production build，不需要再并发启动构建。`dist/`、`node_modules/` 和
VSIX 都是可重新生成的产物，不纳入 Git。

`pnpm run package:vsix:preview` 生成带预发布标记的同名本地 VSIX，不执行发布。
`pnpm run package:chat-ui` 生成独立 UI tarball。发布前还需许可证来源复核、
拟公开内容审阅、完整源码提交及干净 VS Code 验收；
详见 [当前状态](STATUS.md)。`pnpm run verify:vsix` 检查包内文件与 manifest；
自动化测试须按项目规则另行获得许可，不属于默认发布工作流。

## GitHub Releases 分发

`.github/workflows/release.yml` 从 `main` 或已合入 `main` 的版本标签构建同一份 VSIX，
完成类型、预算、构建与包内容校验，再生成版本附件。此流程不调用 Marketplace／
Open VSX，不需要两平台的发布者账号或 PAT；创建草稿使用仓库自带的 `GITHUB_TOKEN`。

先完成 [STATUS](STATUS.md#发布与能力缺口) 中的发布待办，再将准备好的源码、
版本与变更记录提交到 `main`。以下以 `0.8.1` 为例；创建 Draft 不等于公开发布。
本地生成下载附件的命令如下，均不上传：

```powershell
pnpm run release:check
pnpm run package:vsix
pnpm run verify:vsix
pnpm run release:assets
```

附件位于 `dist/release/v0.8.1/`：`droid-0.8.1.vsix`、`SHA256SUMS.txt`、
`RELEASE_NOTES.txt` 和 `build-info.json`。构建信息包含源码提交、工作区是否有未提交
改动以及安装包摘要；本地脏工作区产物只作准备包，正式附件使用标签的干净构建。

GitHub 上的操作顺序：

1. **只构建**：Actions → **Build Droid release → Run workflow**，选 `main`，
   `tag` 留空、`draft_release` 不勾选。下载运行页面的 `droid-vx.y.z` artifact，
   保存期限为 30 天。这不创建 Release，也不改变仓库可见性。
2. **准备版本草稿**：确认所有待发布源码已提交、版本和 `CHANGELOG.md` 对应后，
   创建并推送同名版本标签，例如 `v0.8.1`。标签推送会构建并创建 Draft Release；
   也可手动填写已有标签并勾选 `draft_release`。普通分支 push 不触发该工作流。
3. **公开发布**：人工检查草稿的说明与附件，确认仓库公开范围，最后点击
   **Publish release**。工作流始终使用
   [`gh release create --draft --verify-tag`](https://cli.github.com/manual/gh_release_create)，
   不自动公开版本或修改仓库可见性。私有仓库的 Release 不对无权限用户开放。

标签必须与根 `package.json` 版本及非空的 `CHANGELOG.md` 版本段落完全一致。
已存在同标签 Release 时工作流会报错，不覆盖附件；如果上传中断留下草稿，先核对
已有附件，缺失附件从原运行的 artifact 补齐。不要重新构建同一版本后混用产物。
已公开版本发现问题应递增版本，不能移动标签或替换已发布安装包。

pnpm 10 可能提示忽略部分依赖的安装脚本；本次 Windows 干净安装在该提示下
仍成功构建和打包，不需要为此默认批准所有脚本。

## 前端开发与预览

Chat、Models、Mission、Viewer 和 Review 统一在 `src/webview-v2/`，只维护这一套前端。
开发入口使用 `vite.webview-v2.config.ts`；目录和配置名保留，命令统一如下：

```powershell
pnpm run dev:webview
```

打开 <http://127.0.0.1:4176/?scenario=ask-user-result&theme=light&width=480>。
通过查询参数选择场景、主题和宽度。非 `/live` 路径使用模拟数据，不要求登录或
模型密钥，不要把它当成真实会话。添加 `view=models`、`view=mission` 或 `view=viewer`
可预览其他页面。

单独检查或构建前端：

```powershell
pnpm run typecheck:webview
pnpm run build:webview
```

单独构建输出在 `dist/webview-v2/`；`pnpm run build` 把五页生产资源输出到
`dist/webview/`，由统一 VSIX 收录。安装状态见 [当前状态](STATUS.md)，默认在 Microsoft VS Code
内安装与验收；安装前核对 CLI 所属产品，避免使用 Cursor 提供的 `code` 别名。

需要真实浏览器联调时，在新电脑的编辑器设置中将机器级
`droidvisx.browserDev.sourceRoot` 指向当地源码目录，不照抄旧电脑绝对路径。
执行 **Droid: Start Browser Dev Client**，打开它复制的新链接。该命令使用
同一前端配置在 `4173/live` 挂载与侧栏相同的 `ChatApp`，连接当前 Host 的真实会话；
不使用固定预览宽度或模拟数据。独立 `4176` 预览不能替代这个启动流程。
升级扩展后先 **Developer: Reload Window**，再重新执行 Start；不要复用旧标签页链接。

## 维护文档网站

文档站使用 VitePress，直接读取 `docs/` 中的 Markdown，不维护第二份正文。
导航、主题和构建配置在 `docs/.vitepress/`。依赖和 lockfile 放在 `docs/`，与根项目独立，不进入扩展的运行时或 VSIX。

在仓库根目录执行：

```sh
npm --prefix docs ci
npm --prefix docs run dev
```

打开终端给出的地址，并进入 `/droid-for-vscode/` 路径。
导航包含使用指南和开发文档；全文搜索在浏览器本地完成，无需外部搜索账号。
站点支持深浅主题、移动端导航、页内目录与架构图。

构建和预览：

```sh
npm --prefix docs run build
npm --prefix docs run preview
```

生成目录为 `docs/.vitepress/dist/`，依赖、缓存和产物都忽略提交。
构建会检查站内死链；源码链接与内部状态／计划文档在网页中指向 GitHub 原文件。
产品首页使用 `docs/index.md` 与 `docs/.vitepress/theme/DroidHome.vue`，
样式独立在 `home.css`，不改变文档页的深浅主题。
首页动效在 `homeMotion.js`，逐字排版在 `HomeMotionText.vue`；参考参数及有意差异见
`DESIGN.md` 的「项目网站与参考动效」。修改后须在获准的浏览器验收中检查手机换行、
滚动入场、模型列表暂停和首页与文档之间的往返，不只核对静态截图。
文档首页仍读取 `docs/README.md`，在网站中对应 `GUIDE.html`，仓库内可正常阅读 Markdown。

`.github/workflows/docs.yml` 只提供手动触发：Actions → **Build Droid docs**。
默认只构建并上传 Pages artifact，不公开网站。首次发布需由维护者确认，
在仓库 **Settings → Pages** 将 Source 设为 **GitHub Actions**，
再从 `main` 手动运行该工作流并勾选 `deploy`。后续更新也使用同一入口。

按当前仓库名，启用后的地址为 `https://fireman-droid.github.io/droid-for-vscode/`。
在首次成功部署前，不把这个地址写成已经上线的下载或文档入口。

产品截图只使用实际界面的脱敏截图；需要时由维护者提供。
不要用模拟界面、错误提示截图或生成图片代替正常使用效果。

## Git 不会迁移的内容

- Droid 登录凭据、BYOK API key、个人模型/heavy 路由和全局设置，需要在新电脑
  重新配置或通过你自己的安全方式迁移，不能提交密钥文件。
- Droid CLI 本地会话历史、Cursor workspaceState/globalStorage、扩展恢复检查点、
  未提交草稿、真实图片附件以及仍运行的 daemon，不会随代码仓库转移。
- 个人或被忽略的 `.factory/skills`、`.cursor/skills`、MCP 连接、插件及自定义
  droid 配置不会自动出现。它们不是应用构建依赖；需要相同代理工具时另行配置。

开发进度和范围见 [STATUS](STATUS.md) 与 [PLAN](PLAN.md)。本地聊天记录不随仓库迁移。

## 验证与开发规则

```powershell
pnpm run typecheck
pnpm run lint:budgets
pnpm run build
```

测试不是默认门禁，未经明确授权不新增、修改或运行测试、浏览器探测或模型请求。
具体授权、提交及协作规则见根目录 `AGENTS.md`。
