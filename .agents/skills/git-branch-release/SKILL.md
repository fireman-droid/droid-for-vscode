---
name: git-branch-release
description: "管理 Droid 项目的 Git 分支基线、精准暂存与原子提交、本地无用分支与旧 worktree 清理、PR 检查与 squash 合并，以及基于 main 版本标签的 GitHub Release / Open VSX 单产物正式发版与本地双编辑器同步安装。"
---

# Git 分支、原子提交、PR 合并与正式发版

本 Skill 隶属 [Droid 开发与交付流水线](../droid-dev-pipeline/SKILL.md)，负责代码管理、分支卫生、PR 门禁与正式版本发布。命令模板与核对细则见 [发版与分支清理清单](references/release-checklist.md)。

## 1. 分支基线与工作区保护

1. **开始前必查**：运行 `git status --short --branch`、`git worktree list` 与 `git log -n 3 --oneline origin/main`，明确当前所在目录、签出分支、未跟踪文件（如 `.vscode/`）以及与 `origin/main` 的关系。
2. **轻量 GitHub Flow**：
   - `main` 是受保护的可构建、可发布主线。
   - 每个独立任务基于同步后的 `origin/main` 创建或复用 `codex/<简短任务名>` 分支；同一任务的后续微调、验收修复和跨轮续接继续使用原分支，不反复新开分支。
3. **保留用户与在途工作**：
   - 未跟踪目录（如 `.vscode/`）、其他未完成任务分支（如打开中的 PR 分支、`codex/wip-*` 分支及对应 worktree）视为有效工作，禁止未经授权执行 `git clean`、`git reset --hard` 或自动 `stash`。

## 2. 精准暂存与原子提交

1. **每完成一项独立可验收工作立即提交**：修完一个 Bug 或完成一个功能，在通过必要静态检查/定向验证并同步对应文档（`docs/STATUS.md`、`docs/DESIGN.md`、`docs/PLAN.md`）后立即创建原子提交，不把多个独立任务攒成一次巨型提交。
2. **显式路径暂存**：
   - 严禁在包含未跟踪文件或无关修改的工作区执行 `git add -A` 或 `git add .`。
   - 只显式暂存本次任务涉及的文件路径：`git add <path1> <path2>`；同一文件中若有无关修改，按 hunk 拆分暂存。
3. **提交前核对三件套**：
   - `git status --short`（确认无 `.vscode/`、`artifacts/`、`dist/`、`*.vsix`、日志或临时文件混入）
   - `git diff --cached --stat`（核对暂存文件列表与行数）
   - `git diff --cached --check`（核对无空白错误或冲突标记）
4. **提交规范**：沿用仓库 Conventional Commits 风格（如 `feat(chat): ...`、`fix(review): ...`、`chore(release): ...`、`docs: ...`）。若 pre-commit hook 修改了本任务文件，核对差异后 amend 一次。

## 3. 本地分支盘点与无用分支清理

当用户要求盘点或清理本地分支时，先区分**有用分支**与**已合入无用分支**：

1. **只读取证**：
   - 列出所有本地分支及关联 worktree：`git branch -vv`、`git worktree list`。
   - 列出远端 PR 状态：`gh pr list --state all --limit 30 --json number,title,headRefName,state,mergedAt`。
   - 对未直接作为 `origin/main` 祖先的分支，核对其提交是否已通过 squash merge 合入 `origin/main`。
2. **分类准则**：
   - **有用分支（保留）**：`main`（同步至 `origin/main`）、当前 `OPEN` PR 的分支、尚有真实未合入代码差异的独立功能分支、以及 `codex/wip-*` 半成品存档分支。
   - **无用分支（可清理）**：对应 PR 已 `MERGED` 或其代码改动已 100% 随历史版本合入 `origin/main` 的分支。
3. **安全清理步骤**：
   - 若待删无用分支正被某个旧 worktree 签出，先执行 `git -C <worktree> status --short --untracked-files=all` 确认无任何未提交或未跟踪改动。
   - 在 Windows 上优先对该干净旧 worktree 执行 `git -C <worktree> checkout --detach` 与 `git worktree prune` 立即释放分支占用（避免同步递归删除大体积 `node_modules` 导致命令超时），随后执行 `git branch -D <obsolete-branches...>`。
   - 若主工作区仍停留在刚合入主线的任务分支，执行 `git checkout -B main origin/main` 切回并同步 `main`。

## 4. 任务分支推送与 PR 检查

1. **推送与创建/更新 PR**：
   - `git push -u origin codex/<task>`
   - PR 标题遵循 Conventional Commits，正文写明：具体问题、最终行为、已运行的验证命令与结果、未验证项（界面改动附预览或截图说明）。
   - 尚有阻塞检查或未完成实现时保持草稿（`gh pr create --draft`）；准备合入时标为就绪（`gh pr ready <pr>`）。
2. **等待必需 CI 检查**：
   - `main` 分支受保护并要求 `PR checks` 通过。使用 `gh run watch <run-id> --exit-status` 跟进最新提交对应的 `PR checks` 运行结果，不以本地打包或安装成功代替远端 CI。

## 5. 合并主线与单产物正式发版（需明确授权）

仅当用户明确要求**合并到正式并发布版本**时执行以下闭环：

1. **发版准备提交（在任务分支完成）**：
   - 更新根 `package.json` 的 `version`（高于市场已有版本）。
   - 在 `CHANGELOG.md` 顶部新增非空的 `## <version>` 章节，概括本次 Highlights 与 Fixed。
   - 更新 `docs/STATUS.md` 当前版本与交付快照。
   - 运行 `pnpm run release:check`、`pnpm run typecheck`、`pnpm run lint:budgets` 及必要回归测试，提交 `chore(release): prepare <version> release` 并推送到任务分支。
2. **Squash 合并至 `main` 并打版本标签**：
   - 待最新提交的 `PR checks` 通过后，执行 `gh pr merge <pr> --squash --delete-branch=false`。
   - 执行 `git fetch origin main`，并用 `git diff --quiet origin/main HEAD` 确认 `origin/main` 的代码树与任务分支完全一致。
   - 在 `origin/main` 的合入提交 `<main-sha>` 上创建带注释标签并推送：
     `git tag -a v<version> <main-sha> -m "Droid <version>"` && `git push origin v<version>`。
3. **等待官方构建并校验单产物**：
   - 使用 `gh run watch` 跟进标签触发的 `release.yml`（`Build Droid release`），该工作流会在干净 `main` 提交上构建并创建 GitHub Release **草稿**。
   - 下载草稿附件至 `dist/release/v<version>/`：
     `gh release download v<version> --dir dist/release/v<version> --clobber`。
   - 核对 `build-info.json`（确认 `tag`、`version`、`sourceSha` 与 `<main-sha>` 一致且 `sourceDirty: false`），校验 `droid-<version>.vsix` 的 SHA256 与 `SHA256SUMS.txt` 完全一致。
   - 将 `dist/release/v<version>/droid-<version>.vsix` 复制到 `dist/droidvisx.vsix`，运行 `pnpm run verify:vsix` 确认归档条目与扩展入口校验通过。
4. **公开 Release 与渠道分发**：
   - 执行 `gh release edit v<version> --draft=false` 正式公开 GitHub Release。
   - 跟进自动触发的 `publish-openvsx.yml`（`Publish Droid to Open VSX`）直至成功，确保 Open VSX 上架的是与 GitHub Release 完全相同的 VSIX 与 SHA256。
   - 如实记录 `publish-marketplace.yml` 状态（未开启 `MARKETPLACE_AUTO_PUBLISH` 时为 `skipped`）。
5. **本地双编辑器同步安装与收尾**：
   - 获准同步安装本地编辑器时，使用同一份 `dist/droidvisx.vsix` 分别调用 Microsoft VS Code CLI 与 Cursor CLI 安装（命令见 [发版与分支清理清单](references/release-checklist.md)），并提示用户执行 `Developer: Reload Window`。
   - 将主工作区切回并同步 `main`（`git checkout -B main origin/main`），按第 3 节清理已合入的本地任务分支。
