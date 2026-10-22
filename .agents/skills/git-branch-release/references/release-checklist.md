# 发版与分支清理命令清单

本参考提供 Windows PowerShell 7 下经过验证的标准命令模板。所有涉及 Node / pnpm 的步骤须在同一条命令内先注入与 CI 一致的 Node 24 PATH。

## 1. 原子提交前核对模板

```powershell
$repo = 'C:\Users\Administrator\Desktop\学习\droid-for-vscode'
Set-Location -LiteralPath $repo

git status --short --branch
# 显式暂存本任务涉及的文件，禁止在脏工作区使用 git add -A
git add <path1> <path2>

git status --short
git --no-pager diff --cached --stat
git --no-pager diff --cached --check
if ($LASTEXITCODE -ne 0) { throw '暂存区格式检查未通过' }
```

## 2. 本地分支盘点模板（只读）

```powershell
$repo = 'C:\Users\Administrator\Desktop\学习\droid-for-vscode'
Set-Location -LiteralPath $repo

git branch -vv
git worktree list
gh pr list --state all --limit 30 --json number,title,headRefName,state,mergedAt |
  ConvertFrom-Json | Format-Table -AutoSize
```

清理已合入主线的分支时，若某个待删分支挂在无未提交改动的旧 worktree 上，先解除引用再删除分支：

```powershell
# 先确认旧 worktree 无未提交或未跟踪改动
git -C $oldWorktree status --short --untracked-files=all
# 脱离分支引用，避免同步删除大体积 node_modules 造成超时
git -C $oldWorktree checkout --detach
git worktree prune
git branch -D $obsoleteBranches
```

## 3. 正式发版与双编辑器安装闭环模板

前提：任务分支已完成 `package.json` 版本号、`CHANGELOG.md` 对应章节与 `docs/STATUS.md` 更新，`pnpm run release:check` 与远端 `PR checks` 已通过，且用户已明确授权合并与发版。

```powershell
$ErrorActionPreference = 'Stop'
$env:Path = 'C:\Users\Administrator\AppData\Roaming\fnm\node-versions\v24.20.0\installation;' + $env:Path
$repo = 'C:\Users\Administrator\Desktop\学习\droid-for-vscode'
Set-Location -LiteralPath $repo

$version = (Get-Content -Raw "$repo\package.json" | ConvertFrom-Json).version
$tag = "v$version"
$prNumber = <PR_NUMBER>

# 1. Squash 合并 PR 到 main 并校验代码树一致
gh pr merge $prNumber --squash --delete-branch=false
if ($LASTEXITCODE -ne 0) { throw 'PR 合并失败' }
git fetch origin main
if ($LASTEXITCODE -ne 0) { throw '拉取 origin/main 失败' }
git diff --quiet origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'origin/main 与当前分支代码树不一致' }

# 2. 在 main 合入提交上创建并推送带注释标签
$mainSha = (git rev-parse origin/main).Trim()
git tag -a $tag $mainSha -m "Droid $version"
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw '推送标签失败' }

# 3. 等待 Build Droid release 工作流生成草稿 Release
Start-Sleep -Seconds 5
$relRunId = gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $relRunId --exit-status
if ($LASTEXITCODE -ne 0) { throw "Release 构建工作流失败：$relRunId" }

# 4. 下载官方构建产物并校验 build-info、SHA256 与 verify:vsix
$relDir = "$repo\dist\release\$tag"
New-Item -ItemType Directory -Force -Path $relDir | Out-Null
gh release download $tag --dir $relDir --clobber
if ($LASTEXITCODE -ne 0) { throw '下载 Release 草稿附件失败' }

$buildInfo = Get-Content -Raw "$relDir\build-info.json" | ConvertFrom-Json
if ($buildInfo.sourceDirty -ne $false -or $buildInfo.sourceSha -ne $mainSha) {
  throw "build-info 校验不通过：$($buildInfo | ConvertTo-Json -Compress)"
}

$vsixFile = "$relDir\droid-$version.vsix"
$actualHash = (Get-FileHash $vsixFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $buildInfo.sha256) {
  throw "SHA256 不一致：实际 $actualHash vs build-info $($buildInfo.sha256)"
}

Copy-Item $vsixFile "$repo\dist\droidvisx.vsix" -Force
pnpm --config.verify-deps-before-run=false --config.manage-package-manager-versions=false run verify:vsix *>&1 |
  Tee-Object -FilePath "$repo\artifacts\vsix-verify-$tag.log"
if ($LASTEXITCODE -ne 0) { throw 'verify:vsix 校验失败' }

# 5. 正式公开 GitHub Release 并等待 Open VSX 自动发布完成
gh release edit $tag --draft=false
if ($LASTEXITCODE -ne 0) { throw '公开 GitHub Release 失败' }

Start-Sleep -Seconds 5
$ovsxRunId = gh run list --workflow publish-openvsx.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $ovsxRunId --exit-status
if ($LASTEXITCODE -ne 0) { throw "Open VSX 发布工作流失败：$ovsxRunId" }

# 6. 获准安装本地编辑器时，使用同一份 VSIX 安装到 Microsoft VS Code 与 Cursor
& 'C:\Users\Administrator\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd' --install-extension "$repo\dist\droidvisx.vsix" --force
if ($LASTEXITCODE -ne 0) { throw 'VS Code 安装失败' }
& 'C:\Users\Administrator\AppData\Local\Programs\cursor\resources\app\codeBin\code.cmd' --install-extension "$repo\dist\droidvisx.vsix" --force
if ($LASTEXITCODE -ne 0) { throw 'Cursor 安装失败' }
```

安装完成后，将主工作区切回 `main`（`git checkout -B main origin/main`），并提示用户在 VS Code 与 Cursor 中执行 `Developer: Reload Window`。
