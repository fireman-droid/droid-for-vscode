import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import ts from 'typescript';

export interface BtwScriptRequest {
  readonly code: string;
  readonly language: 'javascript' | 'typescript';
  readonly files: Readonly<Record<string, string>>;
}
export interface BtwScriptResult {
  readonly ok: boolean;
  readonly output: string;
  readonly value?: string;
  readonly error?: string;
}
const OUTPUT_LIMIT = 16_000;

/** Guest code runs inside WASM, with no Node objects or host resource APIs. */
export async function evaluateBtwScript(request: BtwScriptRequest): Promise<BtwScriptResult> {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 2_000;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  let output = '';
  try {
    const emit = context.newFunction('__btwEmit', value => {
      const text = context.getString(value);
      if (output.length + text.length + 1 > OUTPUT_LIMIT) throw new Error('Analysis output limit exceeded.');
      output += `${text}\n`;
    });
    context.setProp(context.global, '__btwEmit', emit);
    emit.dispose();
    const setup = context.evalCode(`
      globalThis.files = Object.freeze(JSON.parse(${JSON.stringify(JSON.stringify(request.files))}));
      globalThis.console = Object.freeze({ log(...values) {
        __btwEmit(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '));
      }});
      globalThis.assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
    `);
    context.unwrapResult(setup).dispose();
    let source = `(async () => {\n'use strict';\n${request.code}\n})()`;
    if (request.language === 'typescript') {
      const compiled = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
        reportDiagnostics: true,
      });
      const errors = compiled.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error) ?? [];
      if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n'));
      source = compiled.outputText;
    }
    const promise = context.unwrapResult(context.evalCode(source, 'btw-analysis.js'));
    try {
      while (runtime.hasPendingJob() && Date.now() < deadline) {
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) {
          const message = guestError(context, jobs.error);
          jobs.error.dispose();
          throw new Error(message);
        }
      }
      const state = context.getPromiseState(promise);
      if (state.type === 'pending') throw new Error('Analysis did not settle within its execution limit. Real timers and external I/O are unavailable.');
      if (state.type === 'rejected') {
        const message = guestError(context, state.error);
        state.error.dispose();
        throw new Error(message);
      }
      try {
        context.setProp(context.global, '__btwResult', state.value);
        const encoded = context.unwrapResult(context.evalCode('JSON.stringify(__btwResult)'));
        try {
          const value = context.typeof(encoded) === 'undefined' ? undefined : context.getString(encoded);
          if (value && value.length > OUTPUT_LIMIT) throw new Error('Analysis result limit exceeded.');
          return { ok: true, output, ...(value === undefined ? {} : { value }) };
        } finally { encoded.dispose(); }
      } finally { state.value.dispose(); }
    } finally { promise.dispose(); }
  } catch (error) {
    return { ok: false, output, error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000) };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

function guestError(context: QuickJSContext, error: QuickJSHandle): string {
  const message = context.getProp(error, 'message');
  try { return context.getString(message).slice(0, 2_000) || 'Analysis failed.'; }
  finally { message.dispose(); }
}
