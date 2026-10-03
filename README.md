# Droid

Droid 是 Factory Droid CLI 在 Cursor / VS Code 中的非官方本地可视化工作台。
聊天复用本机 Droid CLI/SDK 的会话、模型、权限、工具与认证。可选的编辑器
代码补全与编辑预测独立连接用户配置的模型服务，不占用聊天会话。

本项目不由 Factory 官方发布、维护或背书。Factory 和 Droid 名称属于各自权利人；
开源许可证不授予其商标使用权。扩展不包含 Droid 服务订阅，也不提供免费的模型额度。

## 安装与开始使用

1. 使用支持 VS Code API `^1.108.0` 的编辑器。
2. 按 [Droid CLI 快速开始](https://docs.factory.ai/droid-cli/quickstart.md)
   安装官方 CLI，并在本机完成认证。模型可用性和费用由 Factory／模型服务商决定；
   BYOK 见 [官方说明](https://docs.factory.ai/model-independence/byok.md)。
3. 安装包通过 [GitHub Releases](https://github.com/fireman-droid/droid-for-vscode/releases)
   提供。在版本页面的 **Assets** 下载 `droidvisx-x.y.z.vsix`，然后在 Microsoft
   VS Code 扩展面板的 `…` 菜单选择 **Install from VSIX**。不要下载 Source code
   压缩包来安装扩展。聊天、模型管理、智能补全与 Next Edit 使用同一个包。
   若 Releases 尚无可下载版本，可按下文从源码构建 `dist/droidvisx.vsix`。
4. 执行 **Developer: Reload Window**，打开 Droid 侧栏，选择工作区和模型。
   仅在理解执行范围后批准工具权限；交互终端的直接输入不经过模型权限流程。

GitHub 下载版更新时重新安装新版 VSIX，不依赖插件市场自动更新。下载文件的 SHA256
应与同一版本 Assets 中的 `SHA256SUMS.txt` 一致；Windows 可运行
`Get-FileHash .\droidvisx-x.y.z.vsix -Algorithm SHA256` 核对。

展示名称已改为 Droid；扩展标识 `droidvisx.droidvisx`、命令／配置前缀与安装包
路径保持原样，覆盖安装继续使用既有设置与会话。

默认 `daemon` 模式让会话在窗口 Reload 后继续运行；也可在设置中明确选择
`process` 模式，每窗口运行独立进程。关闭面板或编辑器不代表 daemon 任务已停止。

## 编辑器代码补全

功能已合入 `main`，随统一安装包提供，默认关闭，无需先打开 Droid 聊天。

1. 命令面板运行 **Droid: Configure Autocomplete**，选择服务，再填写完整地址、
   模型和密钥。提供 Mistral/Codestral、DeepSeek、SiliconFlow、Ollama、自定义 FIM，以及 Inception/Mercury FIM 和 Next Edit 预设。
   Ollama 默认地址是 `http://localhost:11434/api/generate`，模型为
   `qwen2.5-coder:7b-base`，需要先自行安装该模型；本地服务可以不填密钥。
2. 配置完成后选择 **Enable autocomplete**。稍作停顿显示灰字，**Tab** 接受、
   **Esc** 关闭；**Droid: Request Code Completion** 可手动请求或重试。
   语言服务候选列表打开时，AI 可继续补全选中项之后的代码。
3. 状态栏 **Droid Tab** 提供启停、自动/仅手动请求、暂停 5/15/60 分钟、立即恢复、
   服务配置、相关文件开关、设置和删除已存密钥；停用后仍可点击状态栏恢复。错误显示在状态栏，自动请求
   对 429/网络/服务错误指数退避，连续失败后暂停 5 分钟；认证/余额错误等待手动重试或重新配置。

普通续写接入 Kilo/Continue 的导入定义、语法路径、近期编辑/浏览/打开文件、排序与
token 裁剪。语法分析资源随包提供，定义查询使用已有语言服务。总请求默认限制为
12,000 个 UTF-16 文本单位，含标头，至少 60% 可用预算留给主文件；优先使用未保存内容。
相关文件可以关闭；无对应语法或语言服务时仍可用当前文件与允许的近期片段。
Codestral 使用多文件模板，其他服务使用语言注释承载关联片段；Mercury FIM 保留关联
片段，修正上游模板丢弃片段后猜错跨文件参数的问题。文件变化会撤回旧请求与旧建议。

Notebook 代码单元使用相邻同语言单元构造上下文，并映射回当前单元接受和撤销；
单元内容或顺序变化会使缓存失效。官方 Mercury Next Edit 模式下，Notebook 自动走
Mercury FIM；普通文件保持当前选定模式，Next Edit 空结果不会自动再请求 FIM。

密钥只保存到编辑器 SecretStorage，并绑定完整 endpoint；官方 Mercury 的 FIM/Edit 两个地址共用凭据。
模型和地址只取用户级配置。
跨文件读取遵循 `.gitignore`、`.droidignore` 和 `droidvisx.autocomplete.excludePatterns`，
跳过已识别的敏感/生成/二进制文件及工作区外链接，不读取聊天历史。默认不枚举项目文件、
不读取剪贴板；`staticContext` 开启后为 TypeScript 枚举至多 2,000 个候选，仍遵循读取规则。
`includeClipboard` 仅接受用户级显式开启，最多读取 4,000 字符；相关文件和剪贴板开关独立。
设置集中在 `droidvisx.autocomplete`。模型服务独立计费或由本地运行，不使用 Factory
订阅或聊天 Session；普通聊天接口不能直接当作 FIM 接口。

支持原生 FIM 的 Mistral/DeepSeek 兼容接口、Ollama `/api/generate`，以及硅基流动的 FIM 扩展。
SiliconFlow 预设使用 `Qwen/Qwen3-Coder-30B-A3B-Instruct`，协议选 `siliconflow-fim`，
地址为 `https://api.siliconflow.cn/v1/chat/completions`；按[官方 FIM 文档](https://docs.siliconflow.cn/docs/userguide/guides/fim)
发送 `prefix/suffix`，使用该平台 API key，不走聊天 Session。
选择模型时需确认其支持代码续写/FIM；Ollama 指令模型的模板可能在 EOF 空后文时进入
聊天，默认选择 base 模型避免此问题。建议质量和延迟仍取决于实际服务及模型。
使用 Cursor Tab 或其他灰字补全时可选择启用一种；状态栏提示可能的竞争来源，不替用户关闭其他补全器。

### Next Edit 编辑预测

选择 **Inception / Mercury Next Edit**，默认模型 `mercury-edit-2`，地址
`https://api.inceptionlabs.ai/v1/edit/completions`，使用 Inception API key。
该模式与 **Inception / Mercury FIM**（`/v1/fim/completions`）可从状态栏切换，
官方两个地址复用 Inception key。其他服务仍按完整地址隔离凭据。

- 同行可续写的内容显示原生灰字；已有代码替换、删除和跨行修改显示主题化修改提示。
- 修改位于别处时，第一次 **Tab** 跳转，第二次接受；光标已在修改处时直接接受。
  **Esc** 丢弃，接受后可 **Undo**。Tab 接管仅在存在待接受修改且没有选区、候选列表或 snippet 时生效。
- 预测使用光标附近可编辑区域、最多 5 段近期编辑历史和允许的相关文件。
  文件被编辑、切换、权限/配置变化后旧建议失效；不完整或截断的回复不会应用。
- 请求、缓存、退格复用、防抖和编辑提示部分移植自
  [Kilo Code](https://github.com/Kilo-Org/kilocode/tree/7d977bce994af36f0edf752cb53e3aefc7aeb214)，
  Kilo MIT、Continue Apache-2.0 及语法包/分词器许可随包分发；Host 生命周期、读取边界和服务适配由 Droid 负责。
- `adaptiveDebounce` 开启时普通续写首个自动请求立即执行，后续初始等待 300ms，
  累积 10 次响应后在 150–1000ms 间调整；Next Edit 使用上游的 250ms 等待。关闭后使用 `debounceMs`。
  建议历史最多 20 条、30 秒，支持继续输入和退格复用。行中续写按 Kilo 只展示首行，
  完整结果留在缓存，继续输入时复用剩余内容。

验证记录见 [STATUS](docs/STATUS.md)。真实模型小样本通过率不等于日常代码接受率，
也没有与 Kilo 做同模型、同输入的产品胜率对比。

代码文档中的模型结果若包含独立的反引号围栏行，扩展会隐藏整条建议并在状态栏提示，
不会自动拆包或截掉那一行。相同上下文缓存拒绝结果，避免自动重复请求；通过状态栏的
**Request suggestion / retry** 可重新请求。Markdown、MDX、纯文本允许围栏；代码里的
内联围栏文字保持原样。缺少语法证据时，包含独立围栏的合法多行字符串/注释补全也可能
被抑制。这只处理可疑格式，不能证明生成代码的语法和语义正确。

## 当前状态

- 当前源码版本：`0.8.1`；公开下载以 Releases 为准，能力与验证状态见 `docs/STATUS.md`
- 主聊天、会话恢复、权限、AskUser、计划、附件、Review、Canvas、
  Skills、MCP、自定义模型和子代理展示已接入
- Mission Control 已接通聊天、独立 Session、readiness、进度和 Worker
- Chat、Models、Mission、Viewer、Review 共用 React 19 / Tailwind 4 前端；
  通用界面另行提供 [`@droidvisx/chat-ui`](packages/chat-ui/README.md)
- 补全交付验证覆盖 Windows 的隔离 VS Code 与 Cursor；macOS、Linux、
  Remote SSH、WSL 和容器环境未完成本轮验收，不作完整兼容保证
- 真实运行、恢复和视觉仍需人工验收；已知限制及审查问题以 `docs/STATUS.md`
  为准，构建通过不等于没有缺陷。独立 UI 包不包含 Claude Code／Codex CLI 接入

## 数据处理与诊断

- 会话中的提示词、附件、工作区及工具内容可能通过 Droid CLI／SDK、所选模型、
  MCP 或插件发往相应服务。其认证、保留策略及服务条款由对应服务决定。
- 扩展会在编辑器的本地存储中保留恢复快照、会话状态和托管图片附件；
  它们不是 Git 仓库的一部分，也不承诺随卸载扩展自动清除。
- Host／SDK 诊断写入 `Droid Logs` 输出频道和扩展 global storage 下的
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

界面保留的风车标识取自 [Factory 官网](https://factory.com/)，来源记录见
[设计说明](docs/DESIGN.md#分发标识)。该标识及相关商标不按本项目 MIT 许可证重新授权，
保留标识不表示本项目获得 Factory 官方背书。

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
- 运行真实会话还需官方 Droid CLI；已验证版本见 `docs/STATUS.md`，不保证所有 CLI 版本兼容。
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
详见 `docs/STATUS.md`。`pnpm run verify:vsix` 检查包内文件与 manifest；
自动化测试须按项目规则另行获得许可，不属于默认发布工作流。

### GitHub Releases 分发

`.github/workflows/release.yml` 从 `main` 或已合入 `main` 的版本标签构建同一份 VSIX，
完成类型、预算、构建与包内容校验，再生成版本附件。此流程不调用 Marketplace／
Open VSX，不需要两平台的发布者账号或 PAT；创建草稿使用仓库自带的 `GITHUB_TOKEN`。

先完成 [STATUS](docs/STATUS.md#发布与能力缺口) 中的公开前待办，再将准备好的源码、
版本与变更记录提交到 `main`。以下以 `0.8.1` 为例；创建 Draft 不等于公开发布。
本地生成下载附件的命令如下，均不上传：

```powershell
pnpm run release:check
pnpm run package:vsix
pnpm run verify:vsix
pnpm run release:assets
```

附件位于 `dist/release/v0.8.1/`：`droidvisx-0.8.1.vsix`、`SHA256SUMS.txt`、
`RELEASE_NOTES.txt` 和 `build-info.json`。构建信息包含源码提交、工作区是否有未提交
改动以及安装包摘要；本地脏工作区产物只作准备包，正式附件使用标签的干净构建。

GitHub 上的操作顺序：

1. **只构建**：Actions → **Build Droid release → Run workflow**，选 `main`，
   `tag` 留空、`draft_release` 不勾选。下载运行页面的 `droidvisx-vx.y.z` artifact，
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

### 前端开发与预览

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
`dist/webview/`，由统一 VSIX 收录。安装状态见 `docs/STATUS.md`，默认在 Microsoft VS Code
内安装与验收；安装前核对 CLI 所属产品，避免使用 Cursor 提供的 `code` 别名。

需要真实浏览器联调时，在新电脑的编辑器设置中将机器级
`droidvisx.browserDev.sourceRoot` 指向当地源码目录，不照抄旧电脑绝对路径。
执行 **Droid: Start Browser Dev Client**，打开它复制的新链接。该命令使用
同一前端配置在 `4173/live` 挂载与侧栏相同的 `ChatApp`，连接当前 Host 的真实会话；
不使用固定预览宽度或模拟数据。独立 `4176` 预览不能替代这个启动流程。
升级扩展后先 **Developer: Reload Window**，再重新执行 Start；不要复用旧标签页链接。

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
