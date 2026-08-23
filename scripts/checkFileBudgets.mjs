// Line-budget gate against large-file regrowth (refactor-plan.md §4).
// Budgets: TS/TSX 900, CSS 800, *.test.* 2000 lines. Files that were
// already over budget when the gate landed are ratcheted: each is
// allowed its recorded ceiling (2026-08-13 line count + 2%), may only
// shrink, and must be removed from the allowlist once under budget.
// Over budget (or over ceiling) exits 1.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const BUDGETS = { ts: 900, tsx: 900, css: 800 };
const TEST_BUDGET = 2000;

// Ratchet allowlist: path -> ceiling. Only ever lower these numbers.
const ALLOWLIST = new Map(Object.entries({
  'src/webview/bridge/validateHostMessage.test.ts': 4707,
  'src/webview/bridge/validateHostMessage.ts': 3887,
  'src/webview/assistant/store.test.ts': 2486,
  'src/runtime/FactoryDroidRuntime.test.ts': 2402,
  'src/runtime/FactoryDroidRuntime.ts': 2276,
  'src/shared/bridgeMessages.ts': 2202,
  'src/webview/assistant/App.tsx': 1748,
  'src/webview/assistant/store.ts': 1635,
  'src/shared/validateMessage.ts': 1593,
  'src/extension/__fixtures__/reconcileRealSession.ts': 1246,
  'src/webview/assistant/thread/Composer.tsx': 1233,
  'src/extension/chat/turnFlow.ts': 1156,
  'src/extension/ChatController.ts': 1123,
  'src/extension/chat/sessionDirectory.ts': 1130,
  'src/extension/chat/runtimeLifecycle.ts': 1102,
  'src/runtime/history/projectSessionHistory.ts': 1042,
  'src/webview/assistant/Thread.tsx': 983,
}));

function suggestion(file) {
  if (file.endsWith('.css')) {
    return 'split by component family into styles/ and extend the @import index';
  }
  if (/\.test\.(ts|tsx)$/.test(file)) {
    return 'split by describe topic onto a shared harness (see ChatController.*.test.ts)';
  }
  if (file.endsWith('.tsx')) {
    return 'extract cohesive components into sibling modules (see thread/)';
  }
  return 'extract free-function domains onto an Internals interface (see extension/chat/)';
}

const failures = [];
const staleAllowlist = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const ext = path.extname(entry.name).slice(1);
    if (!(ext in BUDGETS)) {
      continue;
    }
    const rel = full.split(path.sep).join('/');
    const lines = readFileSync(full, 'utf8').split(/\r?\n/).length;
    const budget = /\.test\.(ts|tsx)$/.test(entry.name)
      ? TEST_BUDGET
      : BUDGETS[ext];
    const ceiling = ALLOWLIST.get(rel);
    if (ceiling !== undefined && lines <= budget) {
      staleAllowlist.push(rel);
      continue;
    }
    const limit = ceiling ?? budget;
    if (lines > limit) {
      failures.push({ rel, lines, limit, budget });
    }
  }
}

walk('src');

for (const { rel, lines, limit, budget } of failures) {
  console.error(
    `${rel}: ${lines} lines exceeds ${limit === budget ? 'budget' : 'ratchet ceiling'} ${limit}` +
      ` (budget ${budget}) — ${suggestion(rel)}`,
  );
}
for (const rel of staleAllowlist) {
  console.error(
    `${rel}: now under budget — remove it from the allowlist in scripts/checkFileBudgets.mjs`,
  );
}
if (failures.length > 0 || staleAllowlist.length > 0) {
  process.exit(1);
}
console.log('file budgets OK');
