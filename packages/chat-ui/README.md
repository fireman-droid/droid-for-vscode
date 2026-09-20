# @droidvisx/chat-ui

可独立分发的 React 19 聊天 UI。它不连接任何 CLI，不依赖 VS Code API、
Factory SDK 或 Droid Bridge；接入项目提供状态、回调和业务插槽。

## 许可证

项目原创代码使用 MIT，见 `LICENSE`。适配源码保留原始许可证，完整条款见
`THIRD_PARTY_LICENSES.txt`；构建附带的 Tailwind 样式和 KaTeX 字体条款见
`dist/THIRD_PARTY_LICENSES.txt`；内联 Markdown Worker 的解析依赖条款也包含其中。
其余外部 npm 运行依赖仍适用各自许可证。
构建脚本和补充许可证均位于包内，复制整个源码目录即可保留独立构建能力。

## 构建与使用

仓库根目录：

```powershell
pnpm run typecheck:chat-ui
pnpm run package:chat-ui
```

输出 `dist/droidvisx-chat-ui-0.1.0.tgz`，供其他项目本地安装。没有发布到 npm。
也可将整个 `packages/chat-ui` 目录复制到其他仓库，在该目录安装依赖并运行
`pnpm run build`。它的 tsconfig、构建脚本和源码均不引用父仓库。

其他项目安装分发包后，提供 React 19 和 React DOM 19，并使用支持 ESM、
CSS 和字体资源的前端构建工具：

```tsx
import {
  UiRoot, ChatLayout, ComposerView, TranscriptView,
  UserMessageView, ReplyView, Markdown,
} from '@droidvisx/chat-ui';
import '@droidvisx/chat-ui/styles.css';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending: boolean;
};

export function ChatPane(props: {
  conversationId: string;
  messages: readonly Message[];
  draft: string;
  sendSignal: number;
  running: boolean;
  sendDisabled: boolean;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const byId = new Map(props.messages.map((message) => [message.id, message]));
  return <UiRoot theme="dark" environment={{
    assistantName: 'Claude Code',
    copyText: (text) => navigator.clipboard.writeText(text),
  }}>
    <ChatLayout header="Claude Code" footer={
      <ComposerView value={props.draft} onChange={props.onDraftChange}
        running={props.running} sendDisabled={props.sendDisabled}
        onSend={props.onSend} onStop={props.onStop} />
    }>
      <TranscriptView conversationId={props.conversationId}
        sessionKey={props.conversationId} sendSignal={props.sendSignal}
        messages={props.messages.map((message) => ({
          ...message, replyEnd: message.role === 'assistant' && !message.pending,
        }))}
        renderMessage={(id, presentation) => {
          const message = byId.get(id)!;
          return message.role === 'user'
            ? <UserMessageView id={id} text={message.text}
                placeholder={presentation.placeholder} />
            : <ReplyView running={message.pending}
                replyText={message.pending ? undefined : message.text}>
                <Markdown text={message.text} streaming={message.pending} />
              </ReplyView>;
        }} />
    </ChatLayout>
  </UiRoot>;
}
```

父容器需要实际高度。示例展示简单的文本消息接线，不包含 Claude Code SDK
或 CLI 适配器，也不会执行命令。多分组回复、工具过程、附件和权限 UI 通过
下列组件及插槽接入，不需要改消息列表／滚动实现。

## 接口边界

| 界面 | 公共入口／数据 |
| --- | --- |
| 布局与输入 | `ChatLayout` 的 header/footer/overlay；`ComposerView` 的值、发送／停止回调、附件／补全／控件插槽 |
| 消息与滚动 | `TranscriptView` 接收稳定 id、role、问题摘要及 `replyEnd`；`renderMessage` 接收原位占位状态 |
| 问题编辑 | `QuestionCardView` 接收受控编辑状态、选区 ref、重发回调；附件、设置、文件恢复内容由项目注入 |
| 回复操作 | `ReplyView` 接收完整复制正文和 running；regenerate/fork 回调缺失时不显示操作 |
| 工具与命令 | `ActivityGroupView`、`ActivityItem`、`ActivityResult`、`CommandCard` 接收已投影标题、状态、结果、命令与动作 |
| 计划 | `PlanLine` 接收 id、结构化 steps、进度与展开选择；不解析任何 CLI 的 Todo 工具协议 |
| 会话和侧聊 | `SessionMenu`、`SideChatSheet` 接收列表／状态和回调；不创建、恢复、隐藏 fork 或关闭真实会话 |
| 只读及 Diff | `ReadOnlyTranscriptView`、`DiffView`、`ReviewFiles`；不读取磁盘、不计算真实文件改动 |
| 基础组件 | `ui/*`、`ai-elements/*` 子路径，沿用共享 Radix 焦点／键盘／Portal 行为 |

- 同一个稳定消息使用相同 id，token 到达时只更新内容，不重建会话身份。
- `TranscriptView` 在新用户消息进入 `messages` 时恢复到底部跟随；
  `sendSignal` 用于输入／导航身份，不会因消息仍在队列中而滚动旧内容。
  需要暂停跟随时调用其 `TranscriptHandle.stopFollowing()`。
  明确的用户操作需要恢复跟随时调用 `TranscriptHandle.scrollToBottom()`，
  同时退出问题导航；业务确认时机由接入层决定，不把普通回复结束当作恢复条件。
  `replyEnd` 表示整次回复最后一个分组，运行中的整次回复不传操作栏正文。
  `sendSignal` 只在用户实际发送时递增，不能随 token 更新。
- 问题渲染使用 `UserMessageView` 或 `QuestionCardView`，并传入 placeholder。
  它们提供吸顶测量和选区保护需要的 `data-question-card`，无需项目自行拼 DOM。
- `UiEnvironmentProvider` 注入产品名称和剪贴板服务。普通浏览器默认使用
  Clipboard API；VS Code 等受限宿主应提供自己的关联请求实现。
- `ContentProvider` 注入文件／Canvas 动作、本地图片加载、主题及可选 Mermaid
  渲染器。HTML 预览是否有沙箱、大小限制和授权，由宿主实现并如实描述。
  Image annotation 的 `maxBytes` 也由项目按实际附件契约提供。
- 普通浏览器可从 `@droidvisx/chat-ui/markdown/mermaidRenderer` 导入
  `renderMermaid`，交给 `ContentProvider.renderDiagram`；此入口延迟加载 Mermaid。
  严格 CSP 的 Webview 可以注入自己的带 nonce 资源加载器。未提供渲染器时保留源码。
- 较长的流式 Markdown 和静态历史由包内共享 Worker 排队解析，完整保留跨段语义；
  解析后的顶层节点分批呈现，卸载取消任务，全部任务和活动流结束后释放线程。
  宿主 CSP 需允许 `worker-src blob:`，无需开放网络或 eval。无 Worker、创建被阻止
  或短正文采用同步解析，这类环境不承诺同等性能。
  直接消费未构建源码时须接入包内 `scripts/markdownWorkerBuild.mjs`
  插件，分发 ESM 已包含内联线程源码。
- `FileChangeView` 提供单文件折叠行与详情插槽；`ChangeSummaryView` 默认显示三个
  文件并可展开更多，接收文件统计、Review／Undo／选中文件回调及只读详情插槽。
  没有回调就不显示对应动作；缺失行数保持未知。归因、回合归属及撤销确认由宿主处理。
- `UiRoot` 提供 light/dark、字体变量 `--chat-font-sans`／`--chat-font-mono`
  和内部 Portal 容器。分发 CSS 的选择器及 reset 限定在 `.agent-chat-ui`；
  字体资源随包提供，不依赖用户工程扫描本包 Tailwind 类名。公共 `@font-face`
  和 Tailwind 的 CSS property 注册属于浏览器级定义，不承诺 Shadow DOM 隔离。
- 可以按需组合这些组件，不需要采用某个 store、消息传输或 CLI 框架。
  权限、模式、模型目录、完成状态和恢复真实性始终由接入项目负责；
  不支持的操作不提供回调，专属界面通过插槽组合。

## Droid 项目的接入方式

Droid 的五个生产入口使用本包。旧组件路径保留薄 re-export，业务包装层只做
Droid 状态投影、Bridge 回调和专属页面组合；没有第二份公共组件实现。
当前 Droid 构建从包源码生成单文件 IIFE，保留脚本 nonce／宿主主题，
仅为内联 Markdown 线程允许 `worker-src blob:`；
其他项目消费分发包的 ESM、声明和 scoped CSS。

类型检查与包构建检查外部依赖和源码边界。真实行为仍需在接入项目中验收；
长流式解析有本地回归与隔离浏览器性能对照，结果见仓库 `docs/STATUS.md`；
这些验证不调用真实模型，也不代替接入项目的完整交互验收。
