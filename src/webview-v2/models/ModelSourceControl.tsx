import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { MODEL_SOURCE_VERSION, isModelSourceMode, matchesModelSource, parseModelSourceState,
  type ModelSourceMode, type ModelSourceRequest } from '../../shared/protocol/modelSourceProtocol';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { Button } from '../ui/button';

const LABELS: Record<ModelSourceMode, string> = { official: '官方', byok: 'BYOK', mixed: '混合' };
const ModelSourceContext = createContext({ mode: 'mixed' as ModelSourceMode,
  error: undefined as string | undefined, setMode: (_mode: ModelSourceMode) => {} });

export function ModelSourceProvider({ children, postMessage }: {
  readonly children: ReactNode;
  readonly postMessage: (message: ModelSourceRequest) => void;
}) {
  const [state, setState] = useState<{ mode: ModelSourceMode; error?: string }>({ mode: 'mixed' });
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const message = parseModelSourceState(event.data);
      if (message) setState({ mode: message.mode, ...(message.error === undefined ? {} : { error: message.error }) });
    };
    window.addEventListener('message', receive);
    postMessage({ type: 'ui.modelSource.read', version: MODEL_SOURCE_VERSION });
    return () => window.removeEventListener('message', receive);
  }, [postMessage]);
  const setMode = useCallback((mode: ModelSourceMode) => {
    postMessage({ type: 'ui.modelSource.set', version: MODEL_SOURCE_VERSION, mode });
  }, [postMessage]);
  return <ModelSourceContext.Provider value={{ mode: state.mode, error: state.error, setMode }}>{children}</ModelSourceContext.Provider>;
}

export const useModelSource = () => useContext(ModelSourceContext);

export function ModelSourceControl({ models, className = '', compact = false }: {
  readonly models?: readonly { readonly id: string; readonly isCustom?: boolean }[];
  readonly className?: string;
  readonly compact?: boolean;
}) {
  const { mode, setMode, error } = useModelSource();
  return <div className={`min-w-0 space-y-1.5 ${className}`}>
    <ToggleGroup type="single" value={mode} aria-label="模型来源" className={compact ? 'flex gap-4' : 'flex w-full gap-1 rounded-md border border-border bg-muted/40 p-1'}
      onValueChange={(value) => { if (isModelSourceMode(value)) setMode(value); }}>
      {(['official', 'byok', 'mixed'] as const).map((value) => {
        const count = models?.filter((model) => matchesModelSource(model, value)).length;
        return <ToggleGroupItem key={value} value={value} aria-label={`${LABELS[value]}模型${count === undefined ? '' : `，${count} 个`}`}
          className={compact ? 'h-7 min-w-0 rounded-none bg-transparent px-0 text-[11px] hover:bg-transparent active:bg-transparent data-[state=on]:bg-transparent data-[state=on]:underline underline-offset-8' : 'h-7 min-w-0 flex-1 gap-1 px-2 text-xs'}>
          {compact && value === 'mixed' ? '全部' : LABELS[value]}{compact || count === undefined ? null : <span className="text-[10px] text-muted-foreground">{count}</span>}
        </ToggleGroupItem>;
      })}
    </ToggleGroup>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}

export function ModelSourceEmpty() {
  const { mode, setMode } = useModelSource();
  return <div role="status" className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
    <p>{mode === 'mixed' ? '没有匹配的模型。' : `此范围内没有匹配的${LABELS[mode]}模型。`}</p>
    {mode !== 'mixed' ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setMode('mixed')}>显示全部来源</Button> : null}
  </div>;
}
