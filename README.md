# DroidVisX

DroidVisX 是 Factory Droid 在 Cursor / VS Code 中的本地可视化工作台。
它复用本机 Droid CLI/SDK 的会话、模型、权限、工具与认证，不建立第二套
AI 后端。

## 当前状态

- 当前版本：`0.7.89`
- 主聊天、会话恢复、权限、AskUser、计划、附件、Review、Canvas、
  Skills、MCP、自定义模型和子代理展示已接入
- Mission Control 已接通完整聊天、独立 Session、readiness、进度和 Worker
- 可靠性修复已覆盖 Daemon 身份与 Lease、durable recovery、Session/Browser Dev
  生命周期、Review queue/watcher、操作资格、Bridge parser 穷尽性和 Question 边界

## 常用命令

```powershell
pnpm install
pnpm run typecheck
pnpm run build
pnpm run package:vsix
pnpm run verify:vsix
cursor --install-extension dist/droidvisx.vsix --force
```

`package:vsix` 由 vsce 的 `vscode:prepublish` 生命周期调用一次
`package:prepare`，按顺序执行 typecheck、文件预算检查和 production build。
测试不是默认门禁，具体执行规则见仓库根目录 `AGENTS.md`。

## 文档

从源码仓库中的 `docs/README.md` 开始。
