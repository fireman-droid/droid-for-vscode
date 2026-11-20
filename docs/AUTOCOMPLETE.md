# 光标代码补全

[返回项目首页](../README.md) · [全部文档](README.md)

光标代码补全随 Droid 安装包提供，默认关闭，使用独立模型服务，无需先打开聊天。

## 配置与使用

1. 命令面板运行 **Droid: Configure Autocomplete**，选择服务，再填写完整地址、
   模型和密钥。支持原生 FIM、SiliconFlow 和本地 Ollama。
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
单元内容或顺序变化会使缓存失效。模型密钥保存到编辑器 SecretStorage。
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

## 触发与采纳

Droid 使用 [Kilo 经典补全](https://github.com/Kilo-Org/kilocode/tree/54de37a85dfef8feb828382d8a71f84139857121/packages/kilo-vscode/src/services/autocomplete) 的补全逻辑。Droid 负责工作区读取权限、服务配置、密钥与传输，无需 Kilo Gateway。
建议只在光标处显示，通过编辑器原生 Tab 接受、Esc 取消。旧版的跨位置编辑预测保存在 `codex/archive-next-edit-0.8.23`，不发预测请求。

- 相关文件优先保留导入定义及当前函数签名使用的类型，再使用近期文件；当前缓冲区已有内容不重复占用参考预算。
  类型依赖会沿当前文件已解析的导入继续展开，不增加额外语言服务请求。查找超时保留已取得的定义，
  下次仅重试未完成的绑定；重命名导入只查询本地绑定一次，避免重复消耗查找时间。

## 效果与输出限制

验证记录见 [STATUS](STATUS.md)。真实模型小样本通过率不等于日常代码接受率，
也没有与 Kilo 做同模型、同输入的产品胜率对比。

模型输出经经典补全后处理再交给编辑器；不会因为末尾单独出现 Markdown 结束围栏就一律拒绝整条代码。在 Java 中，建议末尾用于关闭建议内部新代码块的 `}`，不会仅因后文也以 `}` 开头而被判为重复。过滤无法保证生成代码的语法或语义正确。
本地日志区分编辑器触发、跳过、共享任务、真实模型请求、空结果和格式/重复过滤；接受事件包含
建议编号，可关联到返回项。结果耗时包含本次调用的等待、策略检查、上下文与请求阶段，另记录
上下文和网络耗时；“返回候选”不代表编辑器确实展示，也不能直接计算真实曝光接受率。

## 自动质量评估（开发用途）

真实模型评估由独立题库提供前文、后文、参考文件和隐藏行为测试；题库作者的参考答案与测试
不发送给补全模型。临时开发 Host 使用 VS Code 正常配置及 SecretStorage 调用 FIM 服务，
无需用户重载窗口、启动 Browser Dev Client 或提供连接；密钥不导出、不复制到测试配置。

```sh
node src/integration/withAutocompleteGateway.mjs "<Microsoft VS Code/Code.exe>" -- node src/integration/generateAutocompleteQuality.mjs --corpus <题库.json> --output <结果.json>
```

运行期间打开一个临时开发窗口，命令结束后自动关闭；原窗口不重载。运行器编译当前网关源码，
使用临时连接描述文件传给子进程，结束后移除该文件。结果记录首次响应、过滤与耗时；生成步骤
会调用真实模型服务。也可继续用 `DROID_AUTOCOMPLETE_BRIDGE_URL` 接入已有 Browser Dev Host。

题库支持 TypeScript、Python 3.11 与 Go 1.23+。审阅生成程序后，运行下列命令检查源码并执行行为断言：

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

Go 使用真实编译器检查本地模块及跨包引用，再为每条隐藏测试启动独立测试进程。
入口属于根目录的 `completion` 包，本地模块名为 `example.invalid/autocomplete-eval`；
`references` 可包含本地子包，`testImports` 声明隐藏测试使用的标准库，默认导入 `testing` 和 `fmt`。
测试需调用 `check(condition, message)`，没有断言、编译失败、运行失败或超时均不能通过；
构建关闭模块下载、工具链下载和 cgo，仅使用标准库及题目文件。可通过 `DROID_AUTOCOMPLETE_GO`
和 `DROID_AUTOCOMPLETE_GOFMT` 指定工具路径。Go 执行限制时间与输出，设置 128 MiB 软内存目标，
没有 Node 的文件／网络权限隔离，必须先审阅候选程序；这也不是恶意代码沙箱。

首次局部续写和整个函数完成应分别统计；不能将尚未补完的函数全部标成语义错误。
题库导入脚本 `src/integration/autocomplete-quality/importDroidCorpus.mjs` 接受 Droid JSON 响应与目标路径，
保留作者会话和原始响应哈希；原始响应、参考实现验证与模型作答分开保存。

该入口的多文件内容由题库明确提供，单独评估提示构造与模型使用上下文的能力，不代表 LSP
检索或编辑器灰字已验证。真实输入、接受、取消、Notebook 和检索走已有
`src/integration/runAutocompleteTest.mjs` 的隔离 Extension Host 命令测试，无需鼠标自动化。

真实模型的原生编辑器评估可给该运行器加 `--quality`，并设置
`DROID_AUTOCOMPLETE_QUALITY_CORPUS` 和 `DROID_AUTOCOMPLETE_QUALITY_OUTPUT`。
运行器加载指定的新 VSIX 到临时用户目录，在隐藏测试桌面通过 VS Code 命令输入、触发和接受建议，
TypeScript 使用内置语言服务寻找参考文件；Python、Go 将题目参考文件打开后使用生产上下文检索，
隔离配置没有这两种语言的语言服务，报告明确记录此差异。Go 在编辑器中用 `gofmt` 只解析、不执行源码，
完整编译与隐藏行为判分在后续步骤进行。每题最多接受 12 次，源码结构完成后只接受已缓存的后续
内容，不再调用模型，缓存耗尽或无建议后停止。停止条件不读取隐藏测试，不能证明函数已实现全部需求。
临时测试配置关闭自动补括号、引号与缩进，并逐字核对原生输入后的前后文，避免编辑器改变题目。
FIM 题目间排除其他题目目录；请求发送前与判分时均核对提示中的参考文件，只允许本题入口和依赖。
报告标记 `native-context-case-isolated`，并记录各请求的参考路径；旧 `native-context` 报告未做这项隔离，
可能包含前题近期文件，应标记为混合上下文观测，不能当作独立题成绩或与隔离结果直接归因比较。
报告记录 VSIX 哈希、自动请求、每次原始返回、接受轨迹与最终源码，再用上述运行器判分。
默认轨迹只接受建议。设置 `DROID_AUTOCOMPLETE_QUALITY_TYPING=newline-after-empty` 可单独评估
回车续写：源文件尚未完成且服务返回空内容时，每题最多通过编辑器输入一次换行，再观察自动请求。
`userEdits` 记录实际插入、位置与自动触发，接受记录另存距该次输入的耗时；这类结果与默认轨迹分别报告，
换行不能计为模型生成字符，也不根据隐藏测试选择输入或增加重试。

设置 `DROID_AUTOCOMPLETE_QUALITY_TYPING=continuous-input` 可对同一独立作者题库重放逐字输入、
停顿后继续及输入错误字符后退格三种轨迹；每个原生操作后核对正文，最终前后文必须与原题完全一致。
报告记录 `typingVariant`、`inputEvents`、最后一次输入时间、请求取消及接受结果。既有行首闭合符
留在初始文件中，避免编辑器自动缩进改写题目。该模式改变输入轨迹，不新增考题或修改隐藏断言，
必须与默认停顿轨迹分别报告；首次接受耗时从最后一次键入完成后开始计算。

`raw-fim` 返回 `streamTiming`，记录响应头、首字节、首个非空白文本、首条完整非空白行和完整响应的
到达时间，以及网络块和文本事件数量。观测仍经生产解析器验证，不改变生成参数或返回代码；
JSON 响应单独标记，缺少完整行时不填该项。首条完整行只是计时点，不代表语法完整或可直接展示。

将同一网关命令的子命令替换为 `node src/integration/runAutocompleteTest.mjs <Code.exe> <VSIX> --quality`
即可验证新包。新 VSIX 的上下文、请求体、过滤与编辑器行为均来自隔离测试进程；网关只转发
已配置的服务及模型，避免旧 Host 重建请求而掩盖新代码变化。普通批量生成也使用当前后处理源码。
可用子命令 `node src/integration/autocomplete-quality/gatewayCheck.cjs` 检查真实 Host 的访问与请求边界，
此检查不调用模型。以上方式依赖本机已有 VS Code 配置与可用模型凭据，不依赖旧浏览器连接。
