# 代码补全与 Next Edit

[返回项目首页](../README.md) · [全部文档](README.md)

功能已合入 `main`，随统一安装包提供，默认关闭，无需先打开 Droid 聊天。

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
- `adaptiveDebounce` 开启时普通续写首个自动请求立即执行，后续初始等待 300ms，
  累积 10 次响应后在 150–1000ms 间调整；Next Edit 使用上游的 250ms 等待。关闭后使用 `debounceMs`。
  建议历史最多 20 条、30 秒，支持继续输入和退格复用。行中续写按 Kilo 只展示首行，
  完整结果留在缓存，继续输入时复用剩余内容。

## 效果与输出限制

验证记录见 [STATUS](STATUS.md)。真实模型小样本通过率不等于日常代码接受率，
也没有与 Kilo 做同模型、同输入的产品胜率对比。

代码文档中的模型结果若包含独立的反引号围栏行，扩展会隐藏整条建议并在状态栏提示，
不会自动拆包或截掉那一行。相同上下文缓存拒绝结果，避免自动重复请求；通过状态栏的
**Request suggestion / retry** 可重新请求。Markdown、MDX、纯文本允许围栏；代码里的
内联围栏文字保持原样。缺少语法证据时，包含独立围栏的合法多行字符串/注释补全也可能
被抑制。这只处理可疑格式，不能证明生成代码的语法和语义正确。
