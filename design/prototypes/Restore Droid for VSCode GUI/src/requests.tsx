import { useEffect, useRef, useState, type ReactNode } from 'react'

function ChevronUp() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden>
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// The current chat context. Requests carry their own Session/Turn ids; anything
// that doesn't match the active session/turn is treated as stale and ignored so
// an old turn can never hijack the current conversation.
export const CURRENT_SESSION = 'sess_9f3a'
export const CURRENT_TURN = 'turn_007'

type ToolName =
  | 'Edit'
  | 'Create'
  | 'Execute'
  | 'Apply Patch'
  | 'MCP Tool'
  | 'Sandbox Violation'
  | 'Droid Shield Violation'

type PermissionAction = {
  tool: ToolName
  permissionType: string
  title: string
  detail: string
  risk?: string
}

type Base = { id: string; sessionId: string; turnId: string }

type PermissionRequest = Base & {
  kind: 'permission'
  actions: PermissionAction[]
  options: string[]
}
type PlanRequest = Base & { kind: 'plan'; plan: string }
type AskQuestion = { topic: string; question: string; choices: string[]; multi: boolean }
type AskUserRequest = Base & { kind: 'ask'; questions: AskQuestion[] }
type MissionRequest = Base & {
  kind: 'mission'
  action: 'Propose Mission' | 'Start Mission Run'
  title: string
  goal: string
  risks: string[]
}

export type DroidRequest =
  | PermissionRequest
  | PlanRequest
  | AskUserRequest
  | MissionRequest

const PLAN_MAX = 32768

// Seed queue — one of each request type so the flow is demonstrable. Working
// through them empties the queue and returns to the normal chat.
const SEED: DroidRequest[] = [
  {
    kind: 'permission',
    id: 'req_001',
    sessionId: CURRENT_SESSION,
    turnId: CURRENT_TURN,
    options: ['仅允许本次', '允许本会话内所有 Edit 操作', '始终允许 Edit'],
    actions: [
      {
        tool: 'Edit',
        permissionType: 'write',
        title: '修改现有文件',
        detail: 'src/App.tsx',
        risk: '将覆盖文件中约 24 行内容，操作不可自动撤销。',
      },
      {
        tool: 'Execute',
        permissionType: 'shell',
        title: '运行命令',
        detail: 'pnpm test --run',
        risk: '将在本地运行时环境中执行命令。',
      },
    ],
  },
  {
    kind: 'plan',
    id: 'req_002',
    sessionId: CURRENT_SESSION,
    turnId: CURRENT_TURN,
    plan: `实施目标\n为 DroidVisX 面板补全权限请求 UI。\n\n具体步骤\n1. 建立请求队列与等待状态管理。\n2. 分别实现权限、Plan、AskUser、Mission 卡片。\n3. 待处理请求时锁定聊天输入框。\n\n涉及代码范围\nsrc/App.tsx、src/requests.tsx。\n\n验证方式\n逐一处理队列中的请求，确认卡片按到达顺序出现。\n\n风险或限制\n当前仅覆盖请求确认阶段，不包含完整 Mission 管理界面。`,
  },
  {
    kind: 'ask',
    id: 'req_003',
    sessionId: CURRENT_SESSION,
    turnId: CURRENT_TURN,
    questions: [
      {
        topic: '目标运行时',
        question: '这些改动应该在哪个环境验证？',
        choices: ['本地开发服务器', 'CI 流水线', '预览环境'],
        multi: false,
      },
      {
        topic: '交付范围',
        question: '本次需要包含哪些内容？',
        choices: ['组件实现', '单元测试', '文档更新'],
        multi: true,
      },
    ],
  },
  {
    kind: 'mission',
    id: 'req_004',
    sessionId: CURRENT_SESSION,
    turnId: CURRENT_TURN,
    action: 'Start Mission Run',
    title: '重构权限请求模块',
    goal: '将请求处理逻辑拆分为独立模块，并补齐各请求类型的交互。',
    risks: [
      'Mission 可能包含多个连续步骤。',
      '可能产生多处代码修改。',
      '可能由多个任务阶段组成。',
    ],
  },
]

const TOOL_TONE: Record<ToolName, string> = {
  Edit: 'text-blue-600',
  Create: 'text-emerald-600',
  Execute: 'text-amber-600',
  'Apply Patch': 'text-violet-600',
  'MCP Tool': 'text-teal-600',
  'Sandbox Violation': 'text-rose-600',
  'Droid Shield Violation': 'text-rose-600',
}

function PrimaryBtn({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function GhostBtn({
  children,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'neutral' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border bg-white px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === 'danger'
          ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
          : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
      }`}
    >
      {children}
    </button>
  )
}

function CardShell({
  eyebrow,
  title,
  children,
  footer,
  waiting,
  inline = false,
}: {
  eyebrow: string
  title: string
  children: ReactNode
  footer: ReactNode
  waiting: boolean
  inline?: boolean
}) {
  return (
    <div className={inline ? 'flex flex-col' : 'flex max-h-[58vh] flex-col'}>
      <div className={inline ? '' : 'px-4 pt-3'}>
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-400">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          {eyebrow}
        </p>
        <h3 className="mt-1 text-[13.5px] font-semibold text-neutral-900">{title}</h3>
      </div>
      <div
        className={`text-[12.5px] leading-relaxed text-neutral-600 ${
          inline ? 'mt-2' : 'scroll-area mt-2 flex-1 overflow-y-auto px-4'
        }`}
      >
        {children}
      </div>
      <div className={`mt-2 flex items-center justify-end gap-2 ${inline ? 'pt-1' : 'px-4 py-2.5'}`}>
        {waiting ? (
          <span className="flex items-center gap-2 text-[12px] text-neutral-400">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-300 border-t-[var(--accent)]" />
            已提交，等待 Droid 确认…
          </span>
        ) : (
          footer
        )}
      </div>
    </div>
  )
}

function PermissionCard({
  req,
  waiting,
  onResolve,
}: {
  req: PermissionRequest
  waiting: boolean
  onResolve: () => void
}) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [primary, ...more] = req.options

  useEffect(() => {
    if (!menu) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menu])

  return (
    <CardShell
      eyebrow="权限请求"
      title={`Droid 请求执行 ${req.actions.length} 项操作`}
      waiting={waiting}
      footer={
        <div className="flex flex-1 items-center justify-end gap-2">
          <GhostBtn tone="danger" onClick={onResolve} disabled={waiting}>
            拒绝
          </GhostBtn>
          {/* Split allow button: primary action + caret that reveals the rest */}
          <div ref={menuRef} className="relative flex">
            <button
              onClick={onResolve}
              disabled={waiting}
              className="rounded-l-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {primary}
            </button>
            {more.length > 0 && (
              <button
                onClick={() => setMenu((v) => !v)}
                disabled={waiting}
                aria-label="更多允许选项"
                className="grid place-items-center rounded-r-md border-l border-white/25 bg-[var(--accent)] px-1.5 text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className={`transition-transform ${menu ? 'rotate-180' : ''}`}>
                  <ChevronUp />
                </span>
              </button>
            )}
            {menu && more.length > 0 && (
              <div className="rise-in absolute bottom-full right-0 z-30 mb-1.5 w-max max-w-[220px] overflow-hidden rounded-lg border border-neutral-200 bg-white py-1 shadow-[0_16px_40px_-14px_rgba(0,0,0,0.28)]">
                {more.map((o) => (
                  <button
                    key={o}
                    onClick={() => {
                      setMenu(false)
                      onResolve()
                    }}
                    disabled={waiting}
                    className="block w-full whitespace-nowrap px-3 py-1.5 text-left text-[12px] text-neutral-700 transition-colors hover:bg-black/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      }
    >
      <div className="divide-y divide-neutral-200/60">
        {req.actions.map((a, i) => (
          <div key={i} className="py-2.5 first:pt-0">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${TOOL_TONE[a.tool]}`}>
                {a.tool}
              </span>
              <span className="text-[11px] text-neutral-400">{a.permissionType}</span>
            </div>
            <p className="mt-1 font-medium text-neutral-800">{a.title}</p>
            <p className="mt-0.5 break-all font-mono text-[11.5px] text-neutral-500">{a.detail}</p>
            {a.risk && (
              <p className="mt-1 flex items-start gap-1.5 text-[11.5px] text-amber-700/90">
                <span className="mt-[1px]">⚠</span>
                {a.risk}
              </p>
            )}
          </div>
        ))}
      </div>
    </CardShell>
  )
}

function PlanCard({
  req,
  waiting,
  onResolve,
}: {
  req: PlanRequest
  waiting: boolean
  onResolve: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(req.plan)
  const over = text.length > PLAN_MAX

  return (
    <CardShell
      eyebrow="实施计划 · ExitSpecMode"
      title="Droid 已完成规划，准备开始实施"
      waiting={waiting}
      footer={
        editing ? (
          <div className="flex flex-1 items-center justify-between gap-2">
            <span className={`text-[11px] ${over ? 'text-rose-600' : 'text-neutral-400'}`}>
              {text.length.toLocaleString()} / {PLAN_MAX.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <GhostBtn onClick={() => setEditing(false)} disabled={waiting}>
                取消编辑
              </GhostBtn>
              <PrimaryBtn onClick={onResolve} disabled={waiting || over}>
                提交计划
              </PrimaryBtn>
            </div>
          </div>
        ) : (
          <>
            <GhostBtn tone="danger" onClick={onResolve} disabled={waiting}>
              拒绝
            </GhostBtn>
            <GhostBtn onClick={() => setEditing(true)} disabled={waiting}>
              编辑后批准
            </GhostBtn>
            <PrimaryBtn onClick={onResolve} disabled={waiting}>
              批准计划
            </PrimaryBtn>
          </>
        )
      }
    >
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`h-56 w-full resize-none rounded-lg border bg-white p-3 font-mono text-[12px] leading-relaxed text-neutral-800 focus:outline-none ${
            over ? 'border-rose-300' : 'border-neutral-200 focus:border-neutral-300'
          }`}
        />
      ) : (
        <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-neutral-600">
          {req.plan}
        </pre>
      )}
    </CardShell>
  )
}

function AskUserCard({
  req,
  waiting,
  onResolve,
  onCancel,
  inline = false,
}: {
  req: AskUserRequest
  waiting: boolean
  onResolve: () => void
  onCancel: () => void
  inline?: boolean
}) {
  const [choice, setChoice] = useState<Record<number, Set<string>>>({})
  const [custom, setCustom] = useState<Record<number, string>>({})

  const answered = (i: number) =>
    (choice[i] && choice[i].size > 0) || (custom[i] && custom[i].trim().length > 0)
  const complete = req.questions.every((_, i) => answered(i))

  const toggle = (qi: number, value: string, multi: boolean) => {
    setChoice((prev) => {
      const next = { ...prev }
      const set = new Set(multi ? next[qi] ?? [] : [])
      if (set.has(value)) set.delete(value)
      else set.add(value)
      next[qi] = set
      return next
    })
  }

  return (
    <CardShell
      eyebrow="AskUser"
      title={`Droid 有 ${req.questions.length} 个问题需要你确认`}
      waiting={waiting}
      inline={inline}
      footer={
        <>
          <GhostBtn onClick={onCancel} disabled={waiting}>
            取消
          </GhostBtn>
          <PrimaryBtn onClick={onResolve} disabled={waiting || !complete}>
            提交回答
          </PrimaryBtn>
        </>
      }
    >
      <div className="divide-y divide-neutral-200/60">
        {req.questions.map((q, i) => (
          <div key={i} className="py-3 first:pt-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {q.topic} · {q.multi ? '多选' : '单选'}
            </p>
            <p className="mt-1 font-medium text-neutral-800">{q.question}</p>
            <div className="mt-1.5 space-y-0.5">
              {q.choices.map((c) => {
                const selected = choice[i]?.has(c)
                return (
                  <button
                    key={c}
                    onClick={() => toggle(i, c, q.multi)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors ${
                      selected ? 'text-neutral-900' : 'text-neutral-600 hover:bg-black/[0.03]'
                    }`}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center border ${
                        q.multi ? 'rounded-[3px]' : 'rounded-full'
                      } ${selected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-neutral-300'}`}
                    >
                      {selected && (
                        <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5" aria-hidden>
                          <path d="M5 12l5 5L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {c}
                  </button>
                )
              })}
            </div>
            <input
              value={custom[i] ?? ''}
              onChange={(e) => setCustom((p) => ({ ...p, [i]: e.target.value }))}
              placeholder="或输入自定义答案…"
              className="mt-1.5 w-full border-b border-neutral-200 bg-transparent px-2 py-1 text-[12px] text-neutral-700 placeholder:text-neutral-400 focus:border-[var(--accent)] focus:outline-none"
            />
          </div>
        ))}
      </div>
    </CardShell>
  )
}

function MissionCard({
  req,
  waiting,
  onResolve,
  onCancel,
}: {
  req: MissionRequest
  waiting: boolean
  onResolve: () => void
  onCancel: () => void
}) {
  return (
    <CardShell
      eyebrow={`Mission · ${req.action}`}
      title={req.title}
      waiting={waiting}
      footer={
        <>
          <GhostBtn tone="danger" onClick={onCancel} disabled={waiting}>
            拒绝
          </GhostBtn>
          <PrimaryBtn onClick={onResolve} disabled={waiting}>
            {req.action === 'Propose Mission' ? '批准提出' : '开始 Mission'}
          </PrimaryBtn>
        </>
      }
    >
      <div className="pb-1">
        <p className="text-neutral-700">{req.goal}</p>
        {req.risks.length > 0 && (
          <div className="mt-2.5 border-t border-neutral-200/60 pt-2.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-600/90">风险说明</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] text-neutral-500">
              {req.risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </CardShell>
  )
}

// Shared queue for the active turn. Permission / Plan / Mission requests are
// rendered inline in the conversation; only AskUser surfaces as a popup card.
export function useRequestQueue() {
  const [queue, setQueue] = useState<DroidRequest[]>(SEED)
  const [waiting, setWaiting] = useState(false)

  // Only requests bound to the active session/turn are eligible.
  const live = queue.filter((r) => r.sessionId === CURRENT_SESSION && r.turnId === CURRENT_TURN)
  const current = live[0]

  // The request stays "processing" until Droid Runtime confirms it is closed;
  // we simulate that confirmation, then advance to the next queued request.
  const resolve = () => {
    if (waiting) return
    setWaiting(true)
    setTimeout(() => {
      setQueue((q) => q.slice(1))
      setWaiting(false)
    }, 650)
  }

  return { current, waiting, remaining: Math.max(0, live.length - 1), resolve }
}

function QueueNote({ remaining }: { remaining: number }) {
  if (remaining <= 0) return null
  return (
    <p className="mb-2 text-[11px] text-neutral-400">
      还有 {remaining} 个请求排队中 · 请先处理当前请求
    </p>
  )
}

// Inline request bubble that lives in the conversation stream.
export function InlineRequest({
  req,
  waiting,
  remaining,
  onResolve,
}: {
  req: PermissionRequest | PlanRequest | MissionRequest
  waiting: boolean
  remaining: number
  onResolve: () => void
}) {
  return (
    <div className="rise-in rounded-xl border border-neutral-200 bg-white/70 px-3.5 py-3 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.25)]">
      <QueueNote remaining={remaining} />
      {req.kind === 'permission' && <PermissionCard req={req} waiting={waiting} onResolve={onResolve} />}
      {req.kind === 'plan' && <PlanCard req={req} waiting={waiting} onResolve={onResolve} />}
      {req.kind === 'mission' && (
        <MissionCard req={req} waiting={waiting} onResolve={onResolve} onCancel={onResolve} />
      )}
    </div>
  )
}

// AskUser is the only request that remains a docked popup above the composer.
export function AskUserPopup({
  req,
  waiting,
  remaining,
  onResolve,
}: {
  req: AskUserRequest
  waiting: boolean
  remaining: number
  onResolve: () => void
}) {
  return (
    <div className="rise-in absolute inset-x-4 bottom-full z-20 mb-2 overflow-hidden rounded-xl border border-neutral-200/70 bg-[#faf9f6] px-4 pt-3 pb-2.5 shadow-[0_12px_32px_-18px_rgba(0,0,0,0.22)]">
      <QueueNote remaining={remaining} />
      <AskUserCard req={req} waiting={waiting} onResolve={onResolve} onCancel={onResolve} inline />
    </div>
  )
}
