# 开发指南

从本地预览开始，完成一个可定位、可验证、可安装的修改。
本文的命令均在仓库根目录执行，除非另有说明。

[文档首页](README.md) · [架构与调用链](ARCHITECTURE.md) · [贡献规则](../AGENTS.md)

## 选择你的起点

| 你准备做什么 | 最短路径 | 是否连接真实会话 |
| --- | --- | --- |
| 改文字、布局、控件或 Markdown 展示 | 安装依赖 → `dev:webview` → 修改公共 UI / 页面适配 | 模拟预览不连接 |
| 改发送、恢复、模型或文件操作 | 构建 VSIX → 安装到编辑器 → 跟踪 Host / Runtime | 编辑器联调会连接 |
| 修改文档 | 安装 `docs/` 依赖 → VitePress 预览与构建 | 不连接 |
| 把聊天界面接入其他产品 | 阅读 [chat-ui 接入文档](../packages/chat-ui/README.md) | 由接入方决定 |

> **先区分预览和联调。** 模拟预览适合检查界面与输入状态；它不会执行 Droid 工具，
> 也不能证明连接、文件恢复或真实模型请求正常。

<a id="environment"></a>

## 准备开发环境

| 依赖 | 要求与用途 |
| --- | --- |
| Git | 克隆源码、查看差异和创建提交 |
| Node.js | 建议使用 24，与仓库 CI 的主版本一致 |
| pnpm | `10.2.0`，由根 `package.json` 的 `packageManager` 固定 |
| 编辑器 | Microsoft VS Code 或兼容的 Cursor，VS Code API `1.108.0+` |
| Droid CLI | 真实聊天联调需要；仅做模拟 UI 预览或文档构建不需要 |

Windows 是主要开发和验证环境。其他系统的运行情况请查 [当前状态](STATUS.md)，
不要把 CI 构建通过理解成所有编辑器环境均已验收。

```sh
node --version
npm install --global pnpm@10.2.0
pnpm --version

git clone https://github.com/fireman-droid/droid-for-vscode.git
cd droid-for-vscode
pnpm install --frozen-lockfile
```

已有副本先检查 `git status`，保存自己的改动，再执行 `git pull --ff-only` 和依赖安装。
保留 lockfile；不要用更新全部依赖来掩盖安装问题。

需要真实会话时，按 [Factory 快速开始](https://docs.factory.ai/droid-cli/quickstart.md)
安装并认证 Droid，确认 `droid --version` 和所选模型正常。
自定义渠道见 [BYOK 文档](https://docs.factory.ai/model-independence/byok.md)。

## 前端开发与预览

```sh
pnpm run dev:webview
```

打开 <http://127.0.0.1:4176/?scenario=ask-user-result&theme=light&width=480>。
该入口使用模拟数据；服务端口固定为 `4176`，被占用时启动会失败，不会悄悄换端口。

| 参数 | 用途 | 示例 |
| --- | --- | --- |
| `scenario` | 选择已有场景 | `ask-user-result`、`full-workflow`、`long-history` |
| `theme` | 主题 | `light`、`dark`、`auto` |
| `width` | 选择预览支持的宽度 | `480` |
| `view` | 切换页面 | `models`、`mission`、`viewer`、`btw`；省略时为 Chat |

可用场景以 [scenarios.ts](../src/webview-v2/dev/scenarios.ts) 为准，
参数与页面路由见 [studioRuntime.ts](../src/webview-v2/dev/studioRuntime.ts)
和 [main.tsx](../src/webview-v2/dev/main.tsx)。Review 不在上述 `view` 路由中，真实入口在编辑器的 Review 面板。

### 前端代码到底在哪

| 位置 | 修改内容 | 依赖边界 |
| --- | --- | --- |
| [`packages/chat-ui/src/ui/`](../packages/chat-ui/src/ui) | Button、Popover、菜单等共享交互控件 | 基于已有 shadcn / Radix 组件 |
| [`packages/chat-ui/src/chat/`](../packages/chat-ui/src/chat) | 输入框、消息、引用、文件修改摘要 | 接收展示数据、回调与插槽 |
| [`packages/chat-ui/src/review/`](../packages/chat-ui/src/review) | Diff 展示、滚动和文本渲染 | 不读取工作区，不直接调用 Git |
| [`src/webview-v2/`](../src/webview-v2) | Droid 页面装配、业务状态与 Bridge 适配 | 不直接访问 SDK、文件系统或模型服务 |

Chat、Models、Mission、Viewer、Review 共享公共 UI。
公共包不能反向引用 Droid Bridge、Host 或 VS Code API；业务能力通过 props、回调和插槽接入。

### 需要真实会话时

1. 先按下文构建并安装扩展。
2. 将机器级设置 `droidvisx.browserDev.sourceRoot` 指向本机源码目录。
3. 执行 **Droid: Start Browser Dev Client**，打开它新复制的链接。

这会在 `4173/live` 使用同一套 `ChatApp` 连接当前 Extension Host，页面操作会作用于真实会话。
扩展升级后先 Reload Window，再重新执行 Start；不要复用旧链接。
结束联调使用 **Droid: Stop Browser Dev Client**。不要把带会话连接信息的链接贴进公开 Issue。

<a id="first-change"></a>

## 完成第一个修改

先用一句话写清“什么操作之后，应该发生什么”，再决定改哪一层。
下面三个例子覆盖本项目常见的修改方式。

### 例一：空输入框按 Shift+Enter

需求是“展开为多行，但光标仍在第一行”。这是输入控件的本地状态，发送内容不应因此增加一个换行符。

1. 从 [`ComposerView.tsx`](../packages/chat-ui/src/chat/ComposerView.tsx) 的键盘处理开始，确认 IME 和补全键盘路由的顺序。
2. 查看 [`measureComposerInput.ts`](../packages/chat-ui/src/chat/measureComposerInput.ts)，区分“展开显示”和“文本包含换行”。
3. 追到 [`Composer.tsx`](../src/webview-v2/chat/Composer.tsx)，确认主聊天怎样提供数据与插槽。
4. 若只改变展开行为，改动停在公共 UI；无需给 Bridge 增加消息，也无需请求 Runtime。

这类修改需要核对空输入、已有文字、再次换行、清空以及中文输入法的行为。
构建验证类型和产物；光标位置仍需界面验收，不能只靠 CSS 类名断言。

### 例二：新增一个跨层交互

如果动作需要读文件、更新设置或调用 Droid，先找到已有业务消息。确实缺少能力时，按以下顺序接入：

```mermaid
flowchart LR
    Contract[共享消息契约] --> Host[Host 处理与错误反馈]
    Host --> Runtime[必要时接 Runtime]
    Runtime --> UI[页面发送与状态呈现]
    UI --> Verify[验证成功及失败路径]
```

以已有 `turn.send` 为参照：

```ts
// src/shared/protocol/turns.ts 中的现有契约
export interface TurnSendMessage {
  readonly type: 'turn.send';
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
}
```

- **契约**：在 [`src/shared/protocol/`](../src/shared/protocol) 找类型和对应校验，再检查 [`bridgeMessages.ts`](../src/shared/bridgeMessages.ts) 的公共出口。
- **Host**：从 [`dispatchChatMessage.ts`](../src/extension/chat/dispatchChatMessage.ts) 找业务处理入口。文件、工作区和权限由 Host 负责。
- **Runtime**：只有需要 Droid 能力时才修改 [`DroidRuntime.ts`](../src/runtime/DroidRuntime.ts) 及适配器；Runtime 不引用 VS Code 或 React。
- **页面**：发送意图后接收 Host 的确认或失败。不能用按钮点击成功来代替后端执行成功。

沿用该业务的 session、turn、request 与 generation 约定，复核迟到结果属于哪个目标。
完整发送过程见 [一次发送经过哪里](ARCHITECTURE.md#send-turn)。

### 例三：修改聊天中的 Diff

先确认需求落在“展示”“归因”还是“撤销”上：

| 需求 | 负责入口 |
| --- | --- |
| 改颜色、行布局、滚动与折叠上下文 | [`packages/chat-ui/src/review/`](../packages/chat-ui/src/review) |
| 从工具卡片打开对应编辑 | [`OperationDiff.tsx`](../src/webview-v2/content/OperationDiff.tsx) 与 Host Review 路由 |
| 判断本轮哪些文件被工具修改 | [`src/extension/chat/changes/`](../src/extension/chat/changes) |
| 恢复文件或提交 Git 修改 | Host 的 Review / Git / 快照路径；不能在展示组件中执行 |

能显示红绿 Diff，只能证明有内容可比较。是否可以撤销，还需要完整修改证据和当前文件冲突检查。
细节见 [Diff、归因和撤销](ARCHITECTURE.md#diff-evidence)。

<a id="debugging"></a>

## 定位与复现一个 Bug

### 先确定停在哪一层

以“后台似乎完成了，页面仍在等待”为例，从同一会话和回合向下追踪：

| 要确认的事实 | 查哪里 | 不能据此推断什么 |
| --- | --- | --- |
| Droid 是否已产生结果 | Runtime 事件与会话历史 | 主面板 Online 不代表子会话已就绪 |
| Host 是否已接收、投影并发布 | `turnRuntimeEvents`、`hostSnapshot` | 收到工具结果不代表整轮已结束 |
| 消息是否送到当前页面 | `webviewStateDelivery`、`hostMessageSource` | `postMessage` 成功不代表页面已应用 |
| reducer 是否接受该身份与序号 | `state/store.ts`、`host/stateReceipt.ts` | 状态 ACK 不代表 DOM 已绘制 |
| 当前界面是否渲染了对应数据 | `Transcript` 及页面诊断 | 屏幕旧内容不等于后台没在运行 |

流程与源码入口见 [页面重新打开不等于重新执行](ARCHITECTURE.md#state-replay)。
不要为了消除等待提示直接补发用户请求；后台可能已经执行过文件写入或模型调用。

### 留下别人能复现的信息

```text
环境：扩展版本 / 源码提交、编辑器、操作系统、Droid CLI、运行模式
起点：新会话还是历史会话，是否已有任务、附件或未提交文件
操作：1. …… 2. …… 3. ……（标出切换、重载、停止发生的时机）
预期：哪个状态应当改变，哪些文件或请求应保持不变
实际：卡住、丢失、重复执行，还是内容与状态不一致
证据：发生时间、脱敏日志、相关 session / turn / request 标识
频率：每次出现，还是需要特定顺序；缩小后仍能触发的步骤
```

运行 **Droid: Open Logs** 或 **Droid: Export Diagnostics Bundle** 收集证据。
多个窗口可能写入同一天日志，用 `act` 区分激活实例，再按同一回合关联事件。
日志位置、事件名和脱敏要求见 [排障指南](TROUBLESHOOTING.md)。

### 修复要保护哪个边界

- **切换目标**：旧 Promise 迟到时，不能覆盖新会话或新工作区。
- **恢复会话**：重新读取状态不能重新执行用户请求。
- **停止失败**：中断请求失败不能显示为已停止并放开下一轮。
- **文件操作**：读取失败不能伪装成空文件，保存失败不能确认已持久化。

选择与本次故障直接相关的边界即可。新增回归前，说明最小触发顺序、预期结果和现有用例缺口；
测试及浏览器自动化按 [AGENTS.md](../AGENTS.md) 获得许可后执行。

<a id="verification"></a>

## 验证与提交

先运行静态检查：

```sh
pnpm run typecheck
pnpm run lint:budgets
```

根据改动选择构建：

| 命令 | 产物或作用 |
| --- | --- |
| `pnpm run build:chat-ui` | 公共 UI 包及类型声明 |
| `pnpm run build:webview` | 独立前端资源，输出 `dist/webview-v2/` |
| `pnpm run build` | 扩展、Worker 与五个生产 Webview，页面输出 `dist/webview/` |
| `pnpm run package:vsix` | 串行执行打包前检查与构建，生成统一 VSIX |
| `npm --prefix docs run build` | 文档静态站与站内文件链接检查 |

打包已经包含 typecheck、预算检查、公共 UI 构建和生产构建，不要同时启动重复构建。
测试不是默认执行步骤；当前项目规定测试、浏览器自动化和截图验证需要明确授权。
构建成功不代表真实会话与界面行为通过验收，交付时分别说明。

一个 PR 应包含具体问题、改后行为、必要文档和实际运行的验证。提交前检查 `git diff` 与暂存区，
保留无关改动，不提交密钥、日志、依赖目录、`dist/` 或 VSIX。
产品事实写入 [STATUS](STATUS.md)，架构和视觉约束分别更新 [ARCHITECTURE](ARCHITECTURE.md) 与 [DESIGN](DESIGN.md)。

<a id="build-install"></a>

## 构建、打包并安装最新源码

```sh
pnpm run package:vsix
pnpm run verify:vsix
```

本地安装包是 `dist/droidvisx.vsix`。通过编辑器扩展面板的 **Install from VSIX…** 安装即可。
也可以使用已确认属于目标产品的 CLI：

```sh
# 先确认 code 来自 Microsoft VS Code；它也可能被 Cursor 提供的别名占用
code --install-extension dist/droidvisx.vsix --force

# 只有目标是 Cursor 时使用
cursor --install-extension dist/droidvisx.vsix --force
```

安装后执行 **Developer: Reload Window**。生产修改默认在 Microsoft VS Code 当前用户扩展目录安装和验收。
`verify:vsix` 校验包内容及入口；它不启动真实模型会话。

| 文件名 | 用途 |
| --- | --- |
| `dist/droidvisx.vsix` | 本地统一构建产物，包含聊天、模型管理、补全和 Next Edit |
| `droid-<version>.vsix` | Releases 对外下载名称 |
| `droidvisx.droidvisx` | 保持设置和更新连续性的内部扩展 ID |

`package:vsix:preview` 生成带预发布标记的本地包，不上传。
`package:chat-ui` 生成独立 UI tarball，接入方式见 [公共包文档](../packages/chat-ui/README.md)。

## GitHub Releases 分发

分发流程是 **准备源码 → 构建与校验 → 生成附件 → 草稿 → 人工公开发布**。
不自动上传 Marketplace 或 Open VSX。

### 本地准备附件

版本来自根 `package.json`，并须有对应的非空 `CHANGELOG.md` 段落：

```sh
pnpm run release:check
pnpm run package:vsix
pnpm run verify:vsix
pnpm run release:assets
```

输出目录为 `dist/release/v<version>/`，包含 VSIX、`SHA256SUMS.txt`、`RELEASE_NOTES.txt` 和 `build-info.json`。
构建信息记录源码提交、脏工作区标记和摘要。脏工作区构建可作本地准备，正式附件使用标签的干净构建。

### GitHub 上的三个动作

| 目标 | 操作 | 结果 |
| --- | --- | --- |
| 只获得构建产物 | Actions → **Build Droid release**，tag 留空，不勾选 draft | 构建 `main`，上传保留 30 天的 artifact |
| 准备版本草稿 | 推送已合入 `main` 的版本标签，或填写已有 tag 并勾选 draft | 构建并创建 Draft Release |
| 公开版本 | 维护者检查版本说明、附件与公开范围后点击 **Publish release** | 对外发布该版本 |

普通分支 push 不触发 Release 工作流。标签、`package.json` 版本与 CHANGELOG 必须一致。
已有同标签 Release 时工作流拒绝覆盖；上传中断只从原构建补缺失附件，避免混用重新构建的产物。
公开版本有问题时递增版本，不移动旧标签或替换旧包。

流程实现见 [release.yml](../.github/workflows/release.yml)
和 [checkRelease.mjs](../scripts/checkRelease.mjs)。公开发布需维护者明确确认。

<a id="docs-site"></a>

## 维护文档网站

文档站使用 VitePress，直接读取 `docs/` Markdown。独立的 `docs/package.json` 与 lockfile
只用于文档构建，不进入扩展运行时。

```sh
npm --prefix docs ci
npm --prefix docs run dev
```

打开终端给出的地址并进入 `/droid-for-vscode/`。文档首页 `docs/README.md` 在网站中映射为 `GUIDE.html`。
使用指南、开发文档与源码链接共享同一份正文；搜索在浏览器本地执行。

```sh
npm --prefix docs run build
npm --prefix docs run preview
```

产物为 `docs/.vitepress/dist/`。构建检查站内文件死链；章节锚点与内容含义仍需要核对。

| 修改目标 | 文件 |
| --- | --- |
| 顶栏、侧栏、搜索和页面配置 | [config.mjs](https://github.com/fireman-droid/droid-for-vscode/blob/main/docs/.vitepress/config.mjs) |
| 将源码及维护记录链接转到 GitHub | [repositoryLinks.mjs](https://github.com/fireman-droid/droid-for-vscode/blob/main/docs/.vitepress/repositoryLinks.mjs) |
| 文档字体、颜色和图文样式 | [style.css](https://github.com/fireman-droid/droid-for-vscode/blob/main/docs/.vitepress/theme/style.css) |
| 产品首页内容与动效 | `docs/index.md`、`DroidHome.vue`、`homeMotion.js`、`HomeMotionText.vue`、`home.css` |

产品首页相关文件位于 `docs/.vitepress/theme/`。文档页和首页各有样式，改文档无需重做首页。
图示使用 Mermaid，截图使用真实界面的脱敏图片。文档尽量按“用途 → 操作/流程 → 边界 → 源码入口”组织；
面向读者解释当前行为，施工记录留在维护文档。

部署通过 [docs.yml](../.github/workflows/docs.yml) 手动触发。默认仅构建 artifact；公开时从 `main`
运行并勾选 `deploy`，且仓库 Pages Source 需设为 **GitHub Actions**。
预期站点路径为 `https://fireman-droid.github.io/droid-for-vscode/`，可访问状态以实际部署为准。

## 换电脑时哪些内容不会迁移

Git 只迁移已提交源码。以下内容需要在新环境重新配置或自行安全迁移：

- Droid 认证、BYOK 密钥、个人模型路由、编辑器全局设置。
- CLI 会话历史、编辑器 workspaceState / globalStorage、恢复检查点、暂存附件和未发送草稿。
- 未纳入版本控制的 Skills、MCP、插件与自定义 Droid 配置。
- 仍在旧电脑上运行的 daemon 与任务。

不要把这些内容作为“让项目能跑”的依赖提交到仓库。登录与模型配置不是构建依赖。
