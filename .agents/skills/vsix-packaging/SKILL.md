---
name: vsix-packaging
description: "为 Droid 扩展构建、打包并校验本地试用 VSIX。用户要求打包、生成安装包或处理打包失败时使用；涵盖 Windows/PowerShell、Node/pnpm 环境、重复构建、包内容污染和交付边界，不自动安装或发布。"
---

# VSIX 打包与故障收口

隶属 [Droid 开发与交付流水线](../droid-dev-pipeline/SKILL.md)。交付一个与已提交源码对应、通过仓库校验的 VSIX。用户只要求打包时，不追加页面验收、
模型调用、安装或发布；用户说“我来验证”时不再扩大回归范围。分支提交与正式发版衔接见 [git-branch-release](../git-branch-release/SKILL.md)。

## 先查事实，不急着重跑

1. 读取项目规则和当前 `package.json` 的 scripts、`packageManager`，
   以及 `.github/workflows/pr-checks.yml`、`.vscodeignore`。
2. 用明确的仓库绝对路径检查 `git status --short`、分支、HEAD 和与 `origin/main` 的差异。
   Worktree 目录名不代表分支；构建必须落在用户指定的签出目录。保留无关改动，不自动 stash、
   切分支、创建 worktree 或把未跟踪文件顺带提交。
3. 检查本次命令实际使用的 Node 和 pnpm：不仅看 `node --version`，
   也检查 `Get-Command node,pnpm`。Node 主版本按 CI，pnpm 按 `packageManager`；
   不把本机 PATH 里的默认版本当成正确环境。
4. 优先使用已安装的匹配环境。Windows/fnm 可检查
   `$env:APPDATA\fnm\node-versions`，选择对应版本的 `installation` 目录。
   未安装所需环境时报告阻塞，安装按当前授权处理。
5. 只有依赖缺失、切换后 lockfile 改变或安装状态不一致，才执行
   `pnpm install --frozen-lockfile`。不升级依赖、不改 lockfile 来绕过构建问题。
6. 功能修改按项目规则完成必要检查并独立提交，再打最终试用包。
   归属不明的修改留在工作区；有无关生产草稿时不要直接打成可交付包。

每次 Execute 都是新进程。设置 PATH、进入仓库、构建和校验必须放在同一次命令中；
单独执行一次 `cd` 或修改 PATH 不会影响下一次调用。

## 最短正确流程

先核对当前脚本是否仍为以下关系：

```text
package:vsix
  → vsce package
  → vscode:prepublish
  → package:prepare
  → typecheck → lint:budgets → build:chat-ui → build
verify:vsix
  → 校验归档内容、清单、资源引用、打包依赖及扩展/Worker 入口
```

因此正常打包只运行一次 `package:vsix`，再运行 `verify:vsix`。
不要先手动跑完整 `package:prepare`，接着又让 vsce 的 prepublish 重跑同一套构建。
不并行执行多个写入同一 `dist` 的构建；前一步失败，后一步立即停止。

### PowerShell 命令模板

把占位路径替换成刚确认的仓库与本机 Node 安装目录。pnpm 必须在该环境下再次核对，
版本不符就停止，不临时升级。

```powershell
$ErrorActionPreference = 'Stop'
$repo = 'C:\path\to\droid-for-vscode'
$nodeRoot = 'C:\path\to\matching-node\installation'
if (-not (Test-Path -LiteralPath (Join-Path $nodeRoot 'node.exe'))) {
  throw '所选 Node 不存在'
}
$env:Path = "$nodeRoot;$env:Path"
Set-Location -LiteralPath $repo

Get-Command node,pnpm | Select-Object Name,Source
node --version
pnpm --version
# 在此核对 Node 与 CI、pnpm 与 packageManager，确认无误再继续。

git -C $repo status --short
$sha = git -C $repo rev-parse --short HEAD
if ($LASTEXITCODE -ne 0) { throw '无法读取源码提交' }

$artifacts = Join-Path $repo 'artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$buildLog = Join-Path $artifacts "vsix-build-$sha.log"
$verifyLog = Join-Path $artifacts "vsix-verify-$sha.log"

# 保留仓库排除规则，只为本次包补排除本地编辑器配置，不移动/删除用户的 .vscode。
$ignoreFile = Join-Path $artifacts "vsix-$sha.ignore"
$rules = [IO.File]::ReadAllText((Join-Path $repo '.vscodeignore'))
[IO.File]::WriteAllText(
  $ignoreFile,
  $rules + "`n.vscode/**`n",
  [Text.UTF8Encoding]::new($false)
)

pnpm run package:vsix --ignoreFile $ignoreFile *> $buildLog
$buildCode = $LASTEXITCODE
if ($buildCode -ne 0) {
  throw "打包失败（$buildCode），读取日志：$buildLog"
}

pnpm run verify:vsix *> $verifyLog
$verifyCode = $LASTEXITCODE
if ($verifyCode -ne 0) {
  throw "包校验失败（$verifyCode），读取日志：$verifyLog"
}

$vsix = Get-Item -LiteralPath (Join-Path $repo 'dist\droidvisx.vsix')
Get-FileHash -LiteralPath $vsix.FullName -Algorithm SHA256
$vsix | Select-Object FullName,Length,LastWriteTime
git -C $repo status --short
```

`--ignoreFile` 必须以当前 `vsce package --help` 为准。替代文件继承完整的 `.vscodeignore`，
不能只写 `.vscode/**` 而漏掉源码、日志、依赖、密钥和 artifacts 的排除。
默认产物以 package 脚本为准，当前为 `dist/droidvisx.vsix`。

## 失败时只处理失败层

- **构建前环境不匹配**：先切到 CI 对应的已安装 Node，再考虑文件占用。
- **`cpSync/unlink`、wasm 拷贝或 Node 崩溃**：按
  [故障处理参考](references/troubleshooting.md) 排查；不凭错误位置断言是编辑器锁文件。
- **测试导入公共 UI 失败**：确认 `packages/chat-ui/dist` 是否过期。
  需要运行这些测试时，先 `pnpm run build:chat-ui`，不为此修改业务 import。
- **已打包，但校验多出文件**：检查归档清单与排除规则。包内容问题不应触发全量测试、
  重装依赖或反复生产构建；一次性本地归档修正的边界见故障参考。
- **校验失败**：包不算交付完成，不放宽 `verifyVsix.mjs` 的断言来伪造通过。
- **同一失败没有新证据**：不要再原样运行。保留退出码和完整日志，读取已写出的日志，
  不用重跑慢命令来“再看一次”输出。

## Windows 与日志的常见坑

- PowerShell 不支持 Bash 的 `<<'PY'` 或反斜杠续行，也不把 `\"` 当作字符串引号转义。
  多行输入用 here-string 或工具输入块；脚本文件用专用读写工具。
- 原生命令失败不一定抛 PowerShell 异常，`$ErrorActionPreference = 'Stop'` 不能代替
  `$LASTEXITCODE`。每次关键命令后立即保存并判断退出码。
- 不把构建输出管进 `Select-Object -Last`、`head`、`tail` 或搜索后据此判断成功。
  将完整输出保存到仓库 `artifacts`，再用读取/搜索工具看结果。
- 只有明确有输出目录冲突或新修改，才重建相关部分。不要连续跑三四次同一构建，
  也不要因生成了新文档就重打已验证的包。
- 除非用户另行授权，不关闭 VS Code、Cursor、Chrome、daemon 或全局 node 进程；
  只允许停止已确认属于本次任务、且不再需要的进程。

## 收口与交付

确认校验命令退出码为 0，输出的校验项目数量以本次实际结果为准，不写死。
核对 VSIX 时间、源码提交、版本与 SHA256，工作区没有新增非预期改动。
构建失败时磁盘可能留着旧包，文件存在不能证明这次成功。

最终只需告诉用户：VSIX 绝对路径、分支/源码提交、校验结果、
“本地试用，未正式发布”，以及未验证项。未获安装授权不安装，不沿用历史安装授权。
若获准安装，先核对编辑器 CLI 所属产品，避免 PATH 中 `code` 实际来自 Cursor；
安装后提示 Reload Window。

正式发布另按项目发布规则：从已合入 main 的干净提交及对应标签构建，
核对版本与 CHANGELOG，各渠道复用同一已校验 VSIX 和 SHA256。
打包授权不包含合并、安装、推送市场或公开发布。
