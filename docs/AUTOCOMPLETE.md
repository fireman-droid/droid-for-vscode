# 代码补全与 Next Edit

[返回项目首页](../README.md) · [全部文档](README.md)

代码补全与 Next Edit 随 Droid 安装包提供，默认关闭，使用独立模型服务，无需先打开聊天。

## 配置与使用

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

<figure class="droid-screenshot">

[![VS Code 中在光标处显示的 TypeScript 灰字补全](images/v0.8.10/final/22-inline-completion.webp)](images/v0.8.10/final/22-inline-completion.webp)

<figcaption>建议显示在光标处，按 Tab 接受。截图来自安装 v0.8.10 的 VS Code，使用本地演示响应。点击查看原图。</figcaption>
</figure>

## 上下文与数据读取

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

## 模型服务与协议

支持原生 FIM 的 Mistral/DeepSeek 兼容接口、Ollama `/api/generate`，以及硅基流动的 FIM 扩展。
SiliconFlow 预设使用 `Qwen/Qwen3-Coder-30B-A3B-Instruct`，协议选 `siliconflow-fim`，
地址为 `https://api.siliconflow.cn/v1/chat/completions`；按[官方 FIM 文档](https://docs.siliconflow.cn/docs/userguide/guides/fim)
发送 `prefix/suffix`，使用该平台 API key，不走聊天 Session。
选择模型时需确认其支持代码续写/FIM；Ollama 指令模型的模板可能在 EOF 空后文时进入
聊天，默认选择 base 模型避免此问题。建议质量和延迟仍取决于实际服务及模型。
使用 Cursor Tab 或其他灰字补全时可选择启用一种；状态栏提示可能的竞争来源，不替用户关闭其他补全器。

## Next Edit 编辑预测

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
- `adaptiveDebounce` 开启时，普通续写在首次输入或至少 1 秒空闲后立即开始准备；连续输入的新任务
  初始等待 150ms，积累响应后在 150–250ms 间调整。Next Edit 保持 250ms；关闭自适应后使用 `debounceMs`。
  兼容的连续输入共享正在等待、收集上下文或生成的任务，不重启计时或重复收集；过期调用不显示结果，
  最后一个消费者离开后只保留 100ms 交接时间。配置、Notebook 或外部上下文变化仍撤销旧任务。
  `if`、`for`、较长标识符和条件右括号后的停顿可以触发，不再按单词长度或结束字符直接禁止请求。
- 建议历史最多 20 条，正结果保留 30 秒，空或过滤结果只保留 1 秒；手动请求可立即绕过负缓存。
  支持继续输入和退格复用，已完全输入的建议允许继续请求下一段。行中续写只展示首行，
  完整结果留在缓存。普通正文编辑保留 ignore 规则缓存；规则修改和完整重置仍使其失效。
- 相关文件优先保留导入定义及当前函数签名使用的类型，再使用近期文件；当前缓冲区已有内容不重复占用参考预算。
  类型依赖会沿当前文件已解析的导入继续展开，不增加额外语言服务请求。查找超时保留已取得的定义，
  下次仅重试未完成的绑定；重命名导入只查询本地绑定一次，避免重复消耗查找时间。

## 效果与输出限制

验证记录见 [STATUS](STATUS.md)。真实模型小样本通过率不等于日常代码接受率，
也没有与 Kilo 做同模型、同输入的产品胜率对比。

代码文档中的模型结果若包含独立的反引号围栏行，扩展会隐藏整条建议并在状态栏提示，
不会自动拆包或截掉那一行。相同上下文短暂缓存拒绝结果，避免自动重复请求；通过状态栏的
**Request suggestion / retry** 可重新请求。Markdown、MDX、纯文本允许围栏；代码里的
内联围栏文字保持原样。缺少语法证据时，包含独立围栏的合法多行字符串/注释补全也可能
被抑制。这只处理可疑格式，不能证明生成代码的语法和语义正确。

重复过滤保留确切重复与循环输出保护，不再仅因两行变量名或字面值相近而拒绝整段代码。
多行建议首尾与相邻代码相同的闭合括号可属于不同嵌套层级，不再因此丢弃整个 `if`、循环或调用。
本地日志区分编辑器触发、跳过、共享任务、真实模型请求、空结果和格式/重复过滤；接受事件包含
建议编号，可关联到返回项。结果耗时包含本次调用的等待、策略检查、上下文与请求阶段，另记录
上下文和网络耗时；“返回候选”不代表编辑器确实展示，也不能直接计算真实曝光接受率。

请求生命周期与诊断本次对照了 [Kilo `d21e197`](https://github.com/Kilo-Org/kilocode/tree/d21e1974a71ccb8895af69076035c966389b490f/packages/kilo-vscode/src/services/autocomplete)：
借鉴待办任务共享、生成结果独立缓存和建议关联，保留 Droid 的取消与文件读取边界。
上游同样存在词长跳过和完整响应后展示的策略，未整体照搬；当前仍等待完整 FIM 响应，
没有宣称具备 Cursor 自有 Tab 模型的延迟或命中率。

## 自动质量评估（开发用途）

真实模型评估由独立题库提供前文、后文、参考文件和隐藏行为测试；题库作者的参考答案与测试
不发送给补全模型。`src/integration/generateAutocompleteQuality.mjs` 通过已启动的 Browser Dev
桥接调用当前 VS Code 配置的 FIM 服务，密钥始终由 Host 的 SecretStorage 读取，不导出。
设置 `DROID_AUTOCOMPLETE_BRIDGE_URL` 为当前开发连接后，传入 `--corpus <题库.json>` 和
`--output <结果.json>` 即可逐题记录首次响应、过滤结果与耗时；这一步会实际调用模型服务。

题库支持 TypeScript 与 Python 3.11。审阅生成程序后，运行下列命令检查源码并执行行为断言：

```sh
node src/integration/runAutocompleteQuality.mjs --corpus <题库.json> --responses <结果.json> --output <报告目录> --reviewed
```

使用 `--reference` 替代
`--responses` 可先校验独立作者的参考答案，不能将这类通过计入模型分数。运行器需要 Node 26+；
TypeScript 使用 strict 类型检查，执行进程只允许读取本题目录与运行器，禁用网络、写入和子进程。
Python 使用语法检查与独立进程中的行为测试，不做静态类型检查；可设置 `DROID_AUTOCOMPLETE_PYTHON`
为 Python 3.11+ 可执行文件，默认使用 `python`。Python 固定 UTF-8，忽略用户环境与 site 配置，
禁写字节码；审计钩子限制文件、网络和子进程操作，允许标准 asyncio 初始化内部唤醒通道。
两种执行均限制时间与输出，逐个隐藏测试重置题目模块；Python 没有 Node 的堆内存上限。
这些限制不能代替对未知程序的审阅，也不宣称是恶意代码安全沙箱。

首次局部续写和整个函数完成应分别统计；不能将尚未补完的函数全部标成语义错误。
题库导入脚本 `src/integration/autocomplete-quality/importDroidCorpus.mjs` 接受 Droid JSON 响应与目标路径，
保留作者会话和原始响应哈希；原始响应、参考实现验证与模型作答分开保存。

该入口的多文件内容由题库明确提供，单独评估提示构造与模型使用上下文的能力，不代表 LSP
检索或编辑器灰字已验证。真实输入、接受、取消、Notebook 和检索走已有
`src/integration/runAutocompleteTest.mjs` 的隔离 Extension Host 命令测试，无需鼠标自动化。

真实模型的原生编辑器评估可给该运行器加 `--quality`，并设置
`DROID_AUTOCOMPLETE_QUALITY_CORPUS` 和 `DROID_AUTOCOMPLETE_QUALITY_OUTPUT`。
运行器加载指定的新 VSIX 到临时用户目录，在隐藏测试桌面通过 VS Code 命令输入、触发和接受建议，
TypeScript 使用内置语言服务寻找参考文件；Python 将题目参考文件打开后使用生产上下文检索，
隔离配置没有 Python 语言服务，报告明确记录此差异。每题最多接受 12 次，源码结构完成后只接受已缓存的后续
内容，不再调用模型，缓存耗尽或无建议后停止。停止条件不读取隐藏测试，不能证明函数已实现全部需求。
临时测试配置关闭自动补括号、引号与缩进，并逐字核对原生输入后的前后文，避免编辑器改变题目。
报告记录 VSIX 哈希、自动请求、每次原始返回、接受轨迹与最终源码，再用上述运行器判分。
审阅题库后再运行；该模式会调用真实模型，并不执行模型代码，代码行为仍在后续受限进程中测试。

当前已连接 Host 只负责使用其保存的密钥调用服务；新 VSIX 的上下文、过滤和编辑器行为都在独立
测试进程中加载，不要求每次改动都重载用户窗口。普通批量生成也会用当前源码重新处理原始返回，
记录处理器哈希和旧 Host 的结果。连接所属 VS Code 进程须保持运行；关闭后不能凭空恢复其临时连接。
