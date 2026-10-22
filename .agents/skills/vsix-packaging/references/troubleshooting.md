# 打包故障处理参考

仅在对应步骤失败时读取。先确定失败层：环境、依赖、构建、归档还是包校验。
不要把一次环境故障扩展成生产代码重构。

## wasm 拷贝报 cpSync/unlink 或 Node 异常退出

已观察到的组合：

- 在默认 Node 22 环境运行构建，覆盖 `tree-sitter.wasm` 时出现 `cpSync` /
  `unlink` 异常，错误对象甚至显示 `errno: 0`、空 `code`。
- 删除单个产物后，错误移动到另一个 grammar wasm；重建目录后又出现
  `0xC0000409`（进程异常终止）。
- 切换到仓库 CI 使用的已安装 Node 24 后，同一份构建脚本完成。

这些证据支持“先统一构建环境”的处理顺序，**没有证明文件被 Cursor、Vite、
杀毒软件或其他进程锁定**，也没有证明所有同类错误都由 Node 版本引起。
重命名成功、进程正在运行或报错路径变化，都不足以确定占用者。

处理顺序：

1. 检查实际 `node --version`、可执行文件路径及 pnpm 版本，对齐 CI。
2. 在同一次命令内设置 PATH 并构建；只切当前命令环境，不改用户全局配置。
3. 环境正确仍失败，才检查该文件的权限、只读属性、链接类型及确切占用证据。
4. 只有确认某个可重建产物损坏，才做最小处理。不要删整个 dist、node_modules 或
   pnpm store，更不能停止所有 Cursor/node 进程来碰运气。
5. 清理可能包含未跟踪用户文件的目录时，按项目授权规则先确认。
   本例不需要安装新 Node，也不需要改 esbuild 脚本。

## 公共 UI 的源码有文件，测试却提示无法 resolve import

`@droidvisx/chat-ui/chat/FileDiffPreview` 曾因公共包构建产物过期加载失败，
表现为若干 `.tsx` 测试套件在导入阶段就失败，尚未执行断言。

核对源码、包 exports 和对应 dist 文件，必要时执行 `pnpm run build:chat-ui`，
然后只重跑被阻塞的相关检查。不要仅看到 Vite 栈中的中文路径就认定是编码错误；
应读取第一条实际异常。打包时的 prepublish 已包含公共包构建，无须重复执行。

## VSIX 校验发现 extension/.vscode/settings.json

未跟踪的本地文件也可能被 vsce 打包；Git 不跟踪不等于打包工具会忽略。
保留用户 `.vscode`，检查当前 `.vscodeignore` 是否排除它。
正常流程用“完整原规则 + `.vscode/**`”的临时 `--ignoreFile`，不改用户设置。

如果源码和生产构建已成功、**仅有已确认的本地编辑器配置多进了归档**，
可对未签名的本地试用包做一次最小归档修正，避免再次运行 prepublish：

- 只移除精确确认的本地配置条目，其他文件逐项验证解压后的 SHA256 不变。
- 保留 ZIP 条目元数据，校验 CRC；用临时输出文件，验证后才替换试用包。
- 完整重跑 `pnpm run verify:vsix`，成功后重新计算整个 VSIX 的 SHA256。
- 失败即停止，不放宽校验，不用这个办法删掉真实必需资源。
- **禁止用于已签名、已公开发布或待正式发布的包**。正式包必须从干净发布源码按
  正确排除规则生成，不能改归档后继续声称原签名/原校验值有效。

以下是针对这一种精确条目的修正示例，不能当作通用“删掉所有多余文件”脚本。
在仓库根运行；多行 Python 用 PowerShell here-string 送入已有 Python：

```powershell
@'
import hashlib
import os
import zipfile

src = os.path.abspath('dist/droidvisx.vsix')
tmp = src + '.packaging-tmp'
excluded = 'extension/.vscode/settings.json'
assert not os.path.exists(tmp), 'Existing temporary archive must be inspected first'

with zipfile.ZipFile(src) as old:
    assert old.namelist().count(excluded) == 1
    assert len(old.namelist()) == len(set(old.namelist()))
    assert not any(name.lower().endswith(('.p7s', '.p7m'))
                   or 'signature' in name.lower() for name in old.namelist())
    expected = {info.filename: hashlib.sha256(old.read(info.filename)).digest()
                for info in old.infolist() if info.filename != excluded}
    with zipfile.ZipFile(tmp, 'w') as clean:
        clean.comment = old.comment
        for info in old.infolist():
            if info.filename != excluded:
                clean.writestr(info, old.read(info.filename))

with zipfile.ZipFile(tmp) as clean:
    assert clean.testzip() is None
    actual = {info.filename: hashlib.sha256(clean.read(info.filename)).digest()
              for info in clean.infolist()}
    assert actual == expected

os.replace(tmp, src)
print('Excluded only local editor settings; all other entry bytes unchanged.')
'@ | python -
if ($LASTEXITCODE -ne 0) { throw '归档修正失败' }

pnpm run verify:vsix
if ($LASTEXITCODE -ne 0) { throw '修正后的包校验失败，不交付' }
Get-FileHash -LiteralPath (Join-Path $repo 'dist\droidvisx.vsix') -Algorithm SHA256
```

示例中的 `$repo`、Node/pnpm 环境和仓库工作目录须先按 skill 主流程确认。
未授权发布的试用包不会因为完成归档修正自动取得发布授权。

## 构建或校验的失败输出被截掉

保存完整日志，再读取报错位置。管道最后一段成功、外层 Script 完成、
`dist/droidvisx.vsix` 存在，均不能替代真实命令的退出码。
PowerShell 输出被显示成红色也不必然失败，Node/esbuild 可能把正常日志写到 stderr。
不得把 `Unexpected VSIX contents` 当作可忽略的提醒。

## 已构建、已打包、已校验、已安装是四件事

构建成功后可能打包失败；打包成功后可能内容校验失败；校验通过也不代表 GUI 问题
已经验收。只按实际完成的阶段报告，不在用户说“我来验收”后继续浏览器或模型验证。
安装前须有本次明确授权；VS Code 与 Cursor 的安装目录和 CLI 各自核对。
