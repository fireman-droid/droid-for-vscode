import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useRequestQueue, InlineRequest, AskUserPopup } from './requests'

type UserMessage = { role: 'user'; text: string }
type DroidMessage = { role: 'droid'; content: ReactNode }
type Message = UserMessage | DroidMessage

const models = [
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
  { id: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
  { id: 'gemini-3.6-flash-high', label: 'gemini-3.6-flash-high' },
  { id: 'gemini-3.1-pro-high', label: 'gemini-3.1-pro-high' },
  { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol', badge: 'Extra High' },
  { id: 'gpt-5.6-terra', label: 'gpt-5.6-terra' },
  { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna' },
  { id: 'glm-5.2', label: 'glm-5.2' },
]

const recentChats = [
  { title: '寻找 React AI Agent 组件库', time: '16h' },
  { title: '你好', time: '17h' },
  { title: '我们现在这个你应该知道是什么吧，第一个，生成 github 仓库，…', time: '2d' },
  { title: '确认对话可见性', time: '2d' },
  { title: '设置子代理', time: '3d' },
  { title: '生成原型图', time: '3d' },
  { title: 'codex 现在有的 skill 和 mcp 帮我看看有哪些', time: '3d' },
  { title: '以 iOS 26 液态玻璃的设计风格做一个带有动画效果的天气卡片，…', time: '3d' },
]

const bold = (text: string) => <span className="font-semibold text-neutral-900">{text}</span>

const conversation: Message[] = [
  { role: 'user', text: '你好' },
  { role: 'droid', content: <p>你好！有什么我可以帮你的吗？</p> },
  { role: 'user', text: '你是什么模型' },
  {
    role: 'droid',
    content: (
      <p>
        我是 {bold('GPT-5.6 Sol')}，在 Factory Droid 软件工程代理环境中运行。
      </p>
    ),
  },
  { role: 'user', text: '你好' },
  { role: 'droid', content: <p>你好！需要我帮你处理什么？</p> },
  { role: 'user', text: '简单介绍一下你自己' },
  {
    role: 'droid',
    content: (
      <div className="space-y-3">
        <p>我是 Droid，由 GPT-5.6 Sol 驱动的软件工程助手。</p>
        <p>我可以帮你：</p>
        <ul className="list-disc space-y-2 pl-6">
          <li>阅读、解释和修改代码</li>
          <li>补全 bug、给出测试、执行代码集合</li>
          <li>设计并实现功能界面</li>
          <li>分析项目架构和指导实施方案</li>
          <li>查阅技术文档、操作 GitHub</li>
          <li>生成 PDF、Word、Excel 和演示文稿</li>
        </ul>
        <p>
          当前我已经接到你的 DroidVisX 项目环境，会遵循仓库规范，保留你的现有改动，并在你见证后执行相关验证。
        </p>
      </div>
    ),
  },
  { role: 'user', text: '也就是说你自己我现在在 Cursor 的哪个文件吗' },
  {
    role: 'droid',
    content: (
      <div className="space-y-3">
        <p>是的，不提示显示你目前在 IDE 中打开了：</p>
        <p className="font-mono text-[12px] font-semibold text-neutral-900">
          .factory/skills/primitives/rcfcrcnccs/thrcad.md
        </p>
        <p>
          但我只能知道环境明确相关的部分信息，无法持续查看你的屏幕、光标位置或未提供的编辑操作。除非我主动读取文件，否则也不知道它的具体内容。
        </p>
      </div>
    ),
  },
]

function ChevronDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ModelSelector({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [thinking, setThinking] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = models.filter((m) => m.label.toLowerCase().includes(query.toLowerCase()))
  const current = models.find((m) => m.id === value)

  return (
    <div ref={ref} className="relative">
      {/* Model name → opens the model list */}
      <button
        onClick={() => {
          setOpen((v) => !v)
          setEditing(null)
        }}
        className="flex items-center gap-1 text-[12px] text-neutral-600 transition-colors hover:text-neutral-900"
      >
        {current?.label ?? value}
        <span className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <ChevronDown />
        </span>
      </button>

      {open && (
        <div className="rise-in absolute bottom-full right-0 z-30 mb-2 flex items-end gap-2">
          {/* Per-model thinking-strength flyout — opens from a row's edit button */}
          {editing && (
            <div className="w-[144px] overflow-hidden rounded-lg border border-neutral-200 bg-[#f5f3ef] py-1 text-[11.5px] text-neutral-700 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.25)]">
              <div className="px-3 pb-1 pt-1.5 text-[11px] text-neutral-400">Options</div>
              <button
                onClick={() => setThinking((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-1 hover:bg-black/5"
              >
                Thinking
                <span
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    thinking ? 'bg-[var(--accent)]' : 'bg-neutral-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                      thinking ? 'left-[14px]' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
              <div className="px-3 pb-1 pt-2 text-[11px] text-neutral-400">Effort</div>
              <button className="flex w-full items-center justify-between px-3 py-1 hover:bg-black/5">
                High
                <span className="text-[var(--accent)]">
                  <Check />
                </span>
              </button>
              <div className="px-3 pb-1 pt-2 text-[11px] text-neutral-400">Context</div>
              <button className="flex w-full items-center justify-between px-3 py-1 hover:bg-black/5">
                200K
                <span className="text-[var(--accent)]">
                  <Check />
                </span>
              </button>
            </div>
          )}

          {/* Model list */}
          <div className="w-[228px] overflow-hidden rounded-lg border border-neutral-200 bg-[#f5f3ef] text-[11.5px] text-neutral-700 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.25)]">
            <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                className="w-full bg-transparent text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
              />
              <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-neutral-400" aria-hidden>
                <path d="M21 12a9 9 0 1 1-3-6.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="scroll-area max-h-[196px] overflow-y-auto py-0.5">
              {filtered.map((m) => (
                <div
                  key={m.id}
                  className={`group flex w-full items-center gap-2 px-3 py-1 hover:bg-black/5 ${
                    editing === m.id ? 'bg-black/5' : ''
                  }`}
                >
                  <button
                    onClick={() => {
                      onChange(m.id)
                      setOpen(false)
                      setEditing(null)
                    }}
                    className="flex flex-1 items-center gap-2 overflow-hidden text-left"
                  >
                    <span className="whitespace-nowrap font-medium text-neutral-800">{m.label}</span>
                    {m.badge && (
                      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-[var(--accent)]">
                        <span>✦</span>
                        {m.badge}
                      </span>
                    )}
                  </button>
                  {m.id === value && (
                    <span className="shrink-0 text-[var(--accent)]">
                      <Check />
                    </span>
                  )}
                  <button
                    onClick={() => setEditing((e) => (e === m.id ? null : m.id))}
                    aria-label={`Edit ${m.label}`}
                    className={`shrink-0 text-neutral-400 transition-opacity hover:text-neutral-700 ${
                      editing === m.id ? 'text-neutral-700 opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
                      <path
                        d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-3 text-neutral-400">No models found</div>
              )}
            </div>
            <button className="w-full border-t border-neutral-200 px-3 py-2.5 text-left font-medium text-neutral-700 hover:bg-black/5">
              Add Models
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function OptionGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200/80 bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-black/[0.03]"
      >
        <span className="text-[12.5px] font-medium text-neutral-700">{label}</span>
        <span className="flex items-center gap-1 text-[12px] text-neutral-500">
          <span className="capitalize">{value}</span>
          <span className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}>
            <ChevronDown />
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-neutral-200/70 py-0.5">
          {options.map((o) => (
            <button
              key={o}
              onClick={() => {
                onChange(o)
                setOpen(false)
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] hover:bg-black/[0.04]"
            >
              <span className={`capitalize ${o === value ? 'text-neutral-900' : 'text-neutral-600'}`}>{o}</span>
              {o === value && (
                <span className="text-[var(--accent)]">
                  <Check />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PlusPanel() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('auto')
  const [autonomy, setAutonomy] = useState('medium')

  return (
    <div className="rise-in absolute inset-x-4 bottom-full z-20 mb-2 rounded-xl border border-neutral-200 bg-[#faf9f6] p-2.5 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.25)]">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5">
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-neutral-400" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search actions, skills, MCP…"
          className="w-full bg-transparent text-[12.5px] text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
        />
      </div>

      <div className="mt-2 space-y-1.5">
        <OptionGroup label="Mode" options={['auto', 'spec', 'Mission']} value={mode} onChange={setMode} />
        <OptionGroup
          label="Autonomy"
          options={['off', 'low', 'medium', 'high']}
          value={autonomy}
          onChange={setAutonomy}
        />
      </div>

      {/* Extensible sections — Skills / MCP live here later */}
      <div className="mt-2 space-y-0.5 border-t border-neutral-200/70 pt-2">
        <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] text-neutral-600 hover:bg-black/[0.04]">
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-neutral-400" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Skills
          </span>
          <span className="text-[11px] text-neutral-400">None</span>
        </button>
        <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] text-neutral-600 hover:bg-black/[0.04]">
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-neutral-400" aria-hidden>
              <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M9 9h6v6H9z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
            MCP servers
          </span>
          <span className="text-[11px] text-neutral-400">None</span>
        </button>
      </div>
    </div>
  )
}

function Collapsible({
  label,
  children,
  defaultOpen = false,
}: {
  label: ReactNode
  children?: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[13px] font-medium text-neutral-700 transition-colors hover:text-neutral-900"
      >
        <span>{label}</span>
        <span className={`text-neutral-400 transition-transform duration-300 ease-out ${open ? '' : '-rotate-90'}`}>
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {children && (
        <div
          className={`grid transition-all duration-300 ease-out ${
            open ? 'mt-1.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-1 text-[12.5px] leading-relaxed text-neutral-400">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState('gpt-5.6-sol')
  const [contextOpen, setContextOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatQuery, setChatQuery] = useState('')
  const { current, waiting, remaining, resolve } = useRequestQueue()
  const pending = Boolean(current)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Bring the active request into view as the queue advances.
  useEffect(() => {
    if (current && current.kind !== 'ask') {
      threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [current])

  // Grow the composer with its content up to a limit, then let it scroll.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }, [draft])

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-300/60 p-4">
      <div className="flex h-[900px] max-h-[95vh] w-full max-w-[430px] flex-col overflow-hidden rounded-2xl bg-[#f5f3ef] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/5">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-neutral-200/80 px-4 py-3">
          <div>
            <h1 className="text-[14px] font-bold leading-tight text-neutral-900">DroidVisX</h1>
            <p className="text-[11px] text-neutral-500">Local runtime connected</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setHistoryOpen(false)}
              className="grid h-8 w-8 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
              aria-label="New chat"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className={`grid h-8 w-8 place-items-center rounded-full border transition-colors ${
                historyOpen
                  ? 'border-neutral-300 bg-neutral-100 text-neutral-700'
                  : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700'
              }`}
              aria-label="History"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path d="M3 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d="M3.05 13A9 9 0 1 0 6 5.3L3 8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="relative flex-1 overflow-hidden">
          {/* Chat history (目录) — drops from the top */}
          {historyOpen && (
            <div className="fade-in absolute inset-0 z-20 flex flex-col bg-[#f5f3ef]">
              <div className="px-4 pb-2 pt-3">
                <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-neutral-400" aria-hidden>
                    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                    <path d="m20 20-3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <input
                    autoFocus
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                    placeholder="Search recent chats"
                    className="w-full bg-transparent text-[12.5px] text-neutral-700 placeholder:text-neutral-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between px-1">
                  <button className="flex items-center gap-1 text-[12.5px] font-medium text-neutral-700 hover:text-neutral-900">
                    All chats
                    <span className="text-neutral-400">
                      <ChevronDown />
                    </span>
                  </button>
                  <button className="text-neutral-400 hover:text-neutral-600" aria-label="Open in panel">
                    <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M15 4v16" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="scroll-area flex-1 overflow-y-auto px-2 pb-3">
                {recentChats
                  .filter((c) => c.title.toLowerCase().includes(chatQuery.toLowerCase()))
                  .map((c, i) => (
                    <button
                      key={i}
                      onClick={() => setHistoryOpen(false)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-black/[0.04]"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-neutral-700">{c.title}</span>
                      <span className="shrink-0 text-[11px] text-neutral-400">{c.time}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="scroll-area h-full space-y-5 overflow-y-auto px-4 py-5 text-[13px] leading-relaxed text-neutral-800">
            {conversation.map((msg, i) =>
              msg.role === 'user' ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl bg-neutral-200/70 px-3 py-2 text-neutral-800">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="pr-1">
                  {msg.content}
                </div>
              ),
            )}

            <div className="space-y-3">
              <Collapsible label={<>Thinking complete · 8s</>}>
                <p>
                  我先确认了当前 IDE 打开的文件路径，再判断能否读取其内容，最后组织了一段简洁的说明来回复。
                </p>
              </Collapsible>
              <Collapsible label={<>Read · completed</>}>
                <p>Read 1 file</p>
                <p className="font-mono">.factory/skills/primitives/rcfcrcnccs/thrcad.md</p>
              </Collapsible>
            </div>

            {/* Permission / Plan / Mission requests appear inline in the thread */}
            {current && current.kind !== 'ask' && (
              <InlineRequest req={current} waiting={waiting} remaining={remaining} onResolve={resolve} />
            )}
            <div ref={threadEndRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="relative px-4 pb-2.5 pt-1">
          {current && current.kind === 'ask' && (
            <AskUserPopup req={current} waiting={waiting} remaining={remaining} onResolve={resolve} />
          )}
          {plusOpen && <PlusPanel />}
          {/* Context usage card — docked to the top edge of the composer, matching its width */}
          {contextOpen && (
            <div className="rise-in absolute inset-x-4 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-neutral-200 bg-[#faf9f6] shadow-[0_18px_44px_-16px_rgba(0,0,0,0.25)]">
              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-3.5">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 text-[var(--accent)]" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.35" />
                    <path d="M12 3a9 9 0 0 1 8.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Context usage
                </span>
                <button className="flex items-center gap-1 text-[12px] text-neutral-500 transition-colors hover:text-neutral-800">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
                    <path d="M3 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3.5 13A9 9 0 1 0 6 5.3L3 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Refresh
                </button>
              </div>

              {/* Headline: percentage + token count */}
              <div className="mt-3 flex items-baseline justify-between px-4">
                <span className="flex items-baseline gap-1">
                  <span className="text-[28px] font-bold leading-none tracking-tight text-neutral-900">26</span>
                  <span className="text-[15px] font-semibold text-neutral-400">%</span>
                  <span className="ml-1 text-[12px] text-neutral-400">used</span>
                </span>
                <span className="font-mono text-[11px] text-neutral-400">
                  52,000 <span className="text-neutral-300">/</span> 200,000
                </span>
              </div>

              {/* Progress */}
              <div className="mt-2.5 px-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[#ff8a5c]"
                    style={{ width: '26%' }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div className="mt-3.5 grid grid-cols-2 divide-x divide-neutral-200/70 border-t border-neutral-200/70">
                <div className="px-4 py-2.5">
                  <p className="text-[10.5px] uppercase tracking-wide text-neutral-400">Remaining</p>
                  <p className="mt-0.5 font-mono text-[13px] font-semibold text-neutral-900">148,000</p>
                </div>
                <div className="px-4 py-2.5">
                  <p className="text-[10.5px] uppercase tracking-wide text-neutral-400">Accuracy</p>
                  <p className="mt-0.5 text-[13px] font-semibold text-emerald-600">Exact</p>
                </div>
              </div>
            </div>
          )}
          <div className="rounded-xl border border-neutral-200 bg-white p-2.5 shadow-sm focus-within:border-neutral-300">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={1}
              disabled={pending}
              placeholder={pending ? '请先处理上方的待处理请求…' : 'Ask Droid about your workspace'}
              className="scroll-area max-h-[168px] w-full resize-none overflow-y-auto bg-transparent px-0.5 text-[13px] leading-relaxed text-neutral-800 placeholder:text-neutral-400 focus:outline-none disabled:cursor-not-allowed"
            />
            <div className="mt-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPlusOpen((v) => !v)
                    setContextOpen(false)
                  }}
                  className={`grid h-7 w-7 place-items-center rounded-md border text-neutral-500 transition-colors ${
                    plusOpen ? 'border-neutral-300 bg-neutral-100' : 'border-neutral-200 hover:bg-neutral-50'
                  }`}
                  aria-label="Add attachment"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    setContextOpen((v) => !v)
                    setPlusOpen(false)
                  }}
                  aria-label="Context usage"
                  className="h-5 w-5 rounded-full border-[3px] border-neutral-200 border-t-[var(--accent)] transition-transform hover:scale-110"
                />
              </div>
              <div className="flex items-center gap-2.5">
                <ModelSelector value={model} onChange={setModel} />
                <button
                  disabled={pending}
                  className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-white shadow-sm transition-[filter,transform] duration-150 hover:brightness-95 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Send"
                >
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                    <path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-center text-[11px] text-neutral-400">
            {pending ? '有待处理请求，请先完成上方操作' : 'Enter to send · Shift+Enter for a new line'}
          </p>
        </div>
      </div>
    </div>
  )
}
