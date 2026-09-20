# DroidVisX

DroidVisX 是 Factory Droid CLI 在 Cursor / VS Code 中的非官方本地可视化工作台。
它复用本机 Droid CLI/SDK 的会话、模型、权限、工具与认证，不建立第二套
AI 后端。

本项目不由 Factory 官方发布、维护或背书。Factory 和 Droid 名称属于各自权利人；
开源许可证不授予其商标使用权。扩展不包含 Droid 服务订阅，也不提供免费的模型额度。

## 安装与开始使用

1. 使用支持 VS Code API `^1.108.0` 的编辑器。
2. 按 [Droid CLI 快速开始](https://docs.factory.ai/droid-cli/quickstart.md)
   安装官方 CLI，并在本机完成认证。模型可用性和费用由 Factory／模型服务商决定；
   BYOK 见 [官方说明](https://docs.factory.ai/model-independence/byok.md)。
3. 在编辑器扩展面板选择 **Install from VSIX**，安装本地构建的 `dist/droidvisx.vsix`。
   当前是发布准备阶段，没有可承诺的 Marketplace 或 GitHub Release 下载入口。
4. 执行 **Developer: Reload Window**，打开 DroidVisX 侧栏，选择工作区和模型。
   仅在理解执行范围后批准工具权限；交互终端的直接输入不经过模型权限流程。

默认 `daemon` 模式让会话在窗口 Reload 后继续运行；也可在设置中明确选择
`process` 模式，每窗口运行独立进程。关闭面板或编辑器不代表 daemon 任务已停止。

## 当前状态

- 当前版本：`0.8.0`；具体已安装版本与源码改动状态见 `docs/STATUS.md`
- 主聊天、会话恢复、权限、AskUser、计划、附件、Review、Canvas、
  Skills、MCP、自定义模型和子代理展示已接入
- Mission Control 已接通聊天、独立 Session、readiness、进度和 Worker
- Chat、Models、Mission、Viewer、Review 共用 React 19 / Tailwind 4 前端；
  通用界面另行提供 [`@droidvisx/chat-ui`](packages/chat-ui/README.md)
- 当前交付验证以 Windows / Cursor 为主；干净 VS Code、macOS、Linux、
  Remote SSH、WSL 和容器环境未完成本轮验收，不作完整兼容保证
- 真实运行、恢复和视觉仍需人工验收；已知限制及审查问题以 `docs/STATUS.md`
  为准，构建通过不等于没有缺陷。独立 UI 包不包含 Claude Code／Codex CLI 接入

## 数据处理与诊断

- 会话中的提示词、附件、工作区及工具内容可能通过 Droid CLI／SDK、所选模型、
  MCP 或插件发往相应服务。其认证、保留策略及服务条款由对应服务决定。
- 扩展会在编辑器的本地存储中保留恢复快照、会话状态和托管图片附件；
  它们不是 Git 仓库的一部分，也不承诺随卸载扩展自动清除。
- Host／SDK 诊断写入 `DroidVisX Logs` 输出频道和扩展 global storage 下的
  `logs` 目录。日志可能包含提示词、工具输入输出、命令、文件路径、会话标识、
  错误和堆栈。凭据形状会脱敏，但不能保证消除所有敏感内容。
- 日志按 UTC 日期轮转，默认总预算为 200 MiB，尽力删除最旧的往日日志。
  当前日文件保留，因此可能超过预算；这不是固定保留天数。
- 在已检查的扩展诊断链路中没有自动上传器。**Export Diagnostics Bundle**
  需要手动执行并选择保存位置，ZIP 包含全部现存诊断日志、环境及工作区路径
  元数据和排障说明。默认建议保存到首个工作区，无工作区时使用 global storage。
  导出命令不自动发送文件；分享前必须人工审阅并移除敏感内容。

勿将诊断 ZIP、真实会话、截图、密钥或个人配置直接附到公开 Issue。
位置和排障步骤见 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)。

## 许可证与反馈

原创代码使用 [MIT](LICENSE)。适配源码和依赖保留原许可证；VSIX 的
`dist/extension/THIRD_PARTY_LICENSES.txt` 与 `dist/webview/THIRD_PARTY_LICENSES.txt`
包含对应构建的第三方条款，公共 UI 包附带独立声明。
构建会阻止缺少许可证材料的分发，但不替代法律或供应链审查。

仓库公开后可通过 [GitHub Issues](https://github.com/fireman-droid/droid-for-vscode/issues)
提交去敏后的问题，格式见 [`docs/FEEDBACK.md`](docs/FEEDBACK.md)。
公开前这些链接只对有仓库权限的人可用。

## 换电脑继续开发

### 环境

建议先复用已验证的 Windows 环境：

- Git，以及用于只读查看分发包内容的 `tar`。
- 建议 Node.js 24 LTS。历史干净目录验证使用 `24.13.1`；
  本轮构建环境和实际验证结果以 `docs/STATUS.md` 为准。
- pnpm `10.2.0`，与 `package.json` 的 `packageManager` 一致。
  未安装时可执行 `npm install --global pnpm@10.2.0`。
- Cursor 或 VS Code；扩展要求 VS Code API `^1.108.0`。
- 运行真实会话还需官方 Droid CLI；本机版本为 `0.211.0`，这不是全版本兼容保证。
  通过 [官方 CLI 快速开始](https://docs.factory.ai/droid-cli/quickstart.md) 安装并完成本机认证；
  BYOK 参考 [官方配置说明](https://docs.factory.ai/model-independence/byok.md)。
  先在新电脑终端确认 `droid --version`，并能正常使用所选模型。

源码不要求放回原电脑的 `D:` 路径。macOS/Linux 未进行本次干净安装验证。

### 拉取与安装依赖

取得仓库访问权限后首次克隆：

```powershell
git clone https://github.com/fireman-droid/droid-for-vscode.git droidvisx
cd droidvisx
pnpm install --frozen-lockfile
```

已有工作副本时，先检查 `git status` 并保存自己的改动，然后在仓库目录执行
`git pull --ff-only` 和 `pnpm install --frozen-lockfile`。
不要通过删除 lockfile 或更新依赖来处理环境差异。

### 构建、打包并安装最新源码

```powershell
pnpm run package:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

VS Code 使用 `code --install-extension dist/droidvisx.vsix --force`；如果编辑器
命令不在 PATH，也可通过扩展面板的 **Install from VSIX** 选择生成文件。
随后执行 **Developer: Reload Window**。

`package:vsix` 的 `vscode:prepublish` 会串行执行 typecheck、文件预算检查、
独立 UI 构建和 production build，不需要再并发启动构建。`dist/`、`node_modules/` 和
VSIX 都是可重新生成的产物，不纳入 Git。

`pnpm run package:vsix:preview` 生成带预发布标记的同名本地 VSIX，不执行发布。
`pnpm run package:chat-ui` 生成独立 UI tarball。发布前还需许可证来源复核、
拟公开内容审阅、完整源码提交、干净 VS Code 验收及发布者权限确认；
详见 `docs/STATUS.md`。`pnpm run verify:vsix` 检查包内文件与 manifest；
自动化测试须按项目规则另行获得许可，不属于默认发布工作流。

### 双市场自动发布

`.github/workflows/release.yml` 为 VS Code Marketplace 和 Open VSX 共用一个
经过类型、预算、构建和包内容校验的 VSIX。Cursor 使用 Open VSX 的第三方扩展库。
工作流配置已准备，正式上架前需完成以下平台配置与仅构建验收。

首次启用需要完成以下配置：

1. 在 [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage/publishers/)
   建立或确认 `droidvisx` 发布者及发布权限；按
   [官方发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
   配置发布凭据。
2. 按 [Open VSX 发布说明](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions)
   注册并关联账号、接受 Publisher Agreement、建立 `droidvisx` namespace。
   两边的扩展 ID 均应为 `droidvisx.droidvisx`；命名空间占用情况须先在平台确认。
3. 在仓库 **Settings → Environments** 创建 `marketplace`，添加 Environment Secrets
   `VSCE_PAT` 和 `OVSX_PAT`。密钥只填平台 Secrets，不写入代码、命令参数或聊天。
   可在该环境配置发布审批；工作流本身不会自动创建审批规则。
4. 将工作流与依赖锁文件提交到默认分支。当前源码仓库仍为私有，发布前须确认
   Marketplace 展示的 README、仓库及问题反馈链接对目标用户可用；工作流不会
   自动改变仓库可见性。首次只构建验收通过后，在仓库 Actions Variables 设置
   `MARKETPLACE_AUTO_PUBLISH=true` 才启用标签自动上传；未设置时标签只构建。

每次正式发版先修改根 `package.json` 的版本，并将对应变更整理到
`CHANGELOG.md` 的 `## x.y.z` 段落。可用以下命令只递增补丁版本，不自动提交或打标签：

```powershell
npm version patch --no-git-tag-version
pnpm run release:check
```

确认版本及改动提交后，创建并推送同名标签，例如 `v0.8.1`。**启用自动上传后，推送
版本标签会触发公开发布**：先构建，再由两个独立发布任务上传相同 VSIX。标签必须与 package.json
版本完全一致，并且有对应版本的变更记录。已发布版本不能覆盖或移动标签，修复应发
新版本。普通分支 push 不触发发布。

需要只构建时，在 Actions 的 **Release extension → Run workflow** 保持 `publish=false`，
标签留空便构建所选分支，也可填写已有版本标签。构建产物 `droidvisx-vx.y.z` 保留
30 天，运行摘要显示 SHA256。上传必须填写已有版本标签并显式设置 `publish=true`；
缺少标签时明确失败，一次运行始终只构建一份安装包。首次直接试构建 main 即可，
无需提前创建正式版本标签。
不要用正式版本标签推送去试跑已启用的自动发布入口。

一个市场失败时，在原运行中选择 **Re-run failed jobs**，复用原构建产物；
成功市场不回滚，也不重新打包。不要使用 **Re-run all jobs** 或重新手动发起工作流
补发已部分发布的版本。上传工具跳过已存在的版本，其他错误正常报失败。
如果原产物已过期，重新准备新版本；不要另开一次构建给同一版本补发不同的安装包。
手动模式只支持稳定版，现有 `package:vsix:preview` 仍仅生成本地预发布包。

pnpm 10 可能提示忽略部分依赖的安装脚本；本次 Windows 干净安装在该提示下
仍成功构建和打包，不需要为此默认批准所有脚本。

### 只看 UI，不连接真实 Runtime

```powershell
pnpm run dev:webview-v2
```

打开 <http://127.0.0.1:4176/?scenario=ask-user-result&theme=light&width=480>。
通过查询参数选择场景、主题和宽度。非 `/live` 路径使用模拟数据，不要求登录或
模型密钥，不要把它当成真实会话。

需要真实浏览器联调时，在新电脑的编辑器设置中将机器级
`droidvisx.browserDev.sourceRoot` 指向当地源码目录，不照抄旧电脑绝对路径。
执行 **DroidVisX: Start Browser Dev Client**，打开它复制的新链接。该命令使用
V2 配置在 `4173/live` 挂载与侧栏相同的 `ChatApp`，连接当前 Host 的真实会话；
不使用固定预览宽度或模拟数据。独立 `4176` 预览不能替代这个启动流程。
升级扩展后先 **Developer: Reload Window**，再重新执行 Start；不要复用旧标签页链接。

### Webview V2

Chat、Models、Mission Control、Viewer 和 Review 的生产构建已统一使用 V2。
安装状态见 `docs/STATUS.md`；可单独预览：

```powershell
pnpm run dev:webview-v2
pnpm run build:webview-v2
```

预览地址为 `http://127.0.0.1:4176/?scenario=conversation&theme=dark&width=400`。
使用模拟数据，不连接模型；添加 `view=models`、`view=mission` 或 `view=viewer`
可预览其他页面。单独构建输出在 `dist/webview-v2/`；`pnpm run build`
把五页生产资源输出到 `dist/webview/`，由 VSIX 收录。界面在 Cursor 内由用户验收。
旧 V1 的 `pnpm run dev:webview`／`4173/app` 仅留作开发/回归参考，
不再由 Browser Dev Client 命令启动，不进入生产包。

### Git 不会迁移的内容

- Droid 登录凭据、BYOK API key、个人模型/heavy 路由和全局设置，需要在新电脑
  重新配置或通过你自己的安全方式迁移，不能提交密钥文件。
- Droid CLI 本地会话历史、Cursor workspaceState/globalStorage、扩展恢复检查点、
  未提交草稿、真实图片附件以及仍运行的 daemon，不会随代码仓库转移。
- 个人或被忽略的 `.factory/skills`、`.cursor/skills`、MCP 连接、插件及自定义
  droid 配置不会自动出现。它们不是应用构建依赖；需要相同代理工具时另行配置。
- 此次对话记录不作为源码上传。接续工作的事实和范围在 `docs/STATUS.md`、
  `docs/PLAN.md` 及两份已提交报告中，新会话先读这些文件即可接着讨论和开发。

## 验证与开发规则

```powershell
pnpm run typecheck
pnpm run lint:budgets
pnpm run build
```

测试不是默认门禁，未经明确授权不新增、修改或运行测试、浏览器探测或模型请求。
具体授权、提交及协作规则见根目录 `AGENTS.md`。

## 文档

从 [`docs/README.md`](docs/README.md) 开始。当前状态看 `STATUS.md`，下一步看
`PLAN.md`；两份报告包含审查证据、覆盖缺口与尚未实施的整改建议。
