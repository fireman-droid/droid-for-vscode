# DroidVisX

DroidVisX 是 Factory Droid 在 Cursor / VS Code 中的本地可视化工作台。
它复用本机 Droid CLI/SDK 的会话、模型、权限、工具与认证，不建立第二套
AI 后端。

## 当前状态

- 当前版本：`0.8.0`；具体已安装版本与源码改动状态见 `docs/STATUS.md`
- 主聊天、会话恢复、权限、AskUser、计划、附件、Review、Canvas、
  Skills、MCP、自定义模型和子代理展示已接入
- Mission Control 已接通聊天、独立 Session、readiness、进度和 Worker
- 最新问答记录显示 AI／我、完整问题和回答；源码已完成，安装后仍需真实验收
- 两份架构/SDK 与运行正确性报告已完成，报告发现的问题尚未整改；不能把
  构建通过或报告完成理解为全项目没有已知缺陷

## 换电脑继续开发

### 环境

建议先复用已验证的 Windows 环境：

- Git，以及 PATH 中可用的 `tar`（VSIX 内容校验使用）。
- Node.js 24；本次干净目录验证使用 `24.13.1`。
- pnpm `10.2.0`，与 `package.json` 的 `packageManager` 一致。
  未安装时可执行 `npm install --global pnpm@10.2.0`。
- Cursor 或 VS Code；扩展要求 VS Code API `^1.108.0`。
- 运行真实会话还需官方 Droid CLI；本机版本为 `0.211.0`，这不是全版本兼容保证。
  通过 [官方 CLI 快速开始](https://docs.factory.ai/droid-cli/quickstart.md) 安装并完成本机认证；
  BYOK 参考 [官方配置说明](https://docs.factory.ai/model-independence/byok.md)。
  先在新电脑终端确认 `droid --version`，并能正常使用所选模型。

源码不要求放回原电脑的 `D:` 路径。macOS/Linux 未进行本次干净安装验证。

### 拉取与安装依赖

首次克隆：

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
pnpm run verify:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

VS Code 使用 `code --install-extension dist/droidvisx.vsix --force`；如果编辑器
命令不在 PATH，也可通过扩展面板的 **Install from VSIX** 选择生成文件。
随后执行 **Developer: Reload Window**。

`package:vsix` 的 `vscode:prepublish` 会串行执行 typecheck、文件预算检查和
production build，不需要再并发或重复启动构建。`dist/`、`node_modules/` 和
VSIX 都是可重新生成的产物，不纳入 Git。

pnpm 10 可能提示忽略部分依赖的安装脚本；本次 Windows 干净安装在该提示下
仍成功构建和打包，不需要为此默认批准所有脚本。

### 只看 UI，不连接真实 Runtime

```powershell
pnpm run dev:webview
```

打开 <http://127.0.0.1:4173/app?scenario=ask-user-result&theme=light&width=480>。
顶部可以切换场景、主题和宽度。`/` 与 `/app` 使用模拟数据，不要求登录或模型密钥；
不要把它当成真实会话。`/live` 是另外的真实联调入口。

需要真实浏览器联调时，在新电脑的编辑器设置中将机器级
`droidvisx.browserDev.sourceRoot` 指向当地源码目录，不照抄旧电脑绝对路径。

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

测试不是默认门禁，具体授权、提交及协作规则见根目录 `AGENTS.md`。
最新问答改动的 7 个文件、96 项定向测试已通过，命令入口见 `docs/PLAN.md`。

## 文档

从 [`docs/README.md`](docs/README.md) 开始。当前状态看 `STATUS.md`，下一步看
`PLAN.md`；两份报告包含审查证据、覆盖缺口与尚未实施的整改建议。
