import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useContext } from 'react';
import { INLINE_DIFF_UNAVAILABLE, InlineDiffContext, useInlineDiff } from '../review/useInlineDiff';
import { DiffView } from '../review/DiffView';
import { Button } from '../ui/button';

export function InlineFileDiff({ path, turnId, expanded }: {
  readonly path: string;
  readonly turnId: string;
  readonly expanded: boolean;
}) {
  const { t } = useI18n();
  const { result, retry, refreshing, refreshFailed } = useInlineDiff(path, turnId, expanded);
  const context = useContext(InlineDiffContext);
  const patch = result?.status === 'ready' ? result.patch : '';
  return <section aria-label={t('Changes to {path}', { path })} className="min-w-0 overflow-hidden rounded border border-border text-xs">
    <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/30 px-2 py-1">
      <span title={t("Workspace comparison, including changes from unconfirmed sources")} className="text-[11px] text-muted-foreground">
        {result?.status !== 'ready' ? t("Workspace comparison") : result.phase === 'live' ? t("Live workspace · before turn → current") : t("Completed turn · before → after")}
      </span>
      {refreshing && result?.status === 'ready' ? <span role="status" className="text-[11px] text-muted-foreground">{t("Updating…")}</span> : null}
      {result?.status === 'ready' && context?.connected && context.sessionId !== null ? <Button variant="ghost" size="sm" onClick={() => context.port.postMessage({
        type: 'file.openTurnDiff', sessionId: context.sessionId!, turnId, path,
      })}>{t("Open diff in editor")}</Button> : null}
    </div>
    {refreshFailed ? <div role="status" className="flex flex-wrap items-center gap-2 p-2">
      <span>{t("Could not refresh. Showing the previous diff.")}</span><Button variant="outline" size="sm" onClick={retry}>{t("Retry")}</Button>
    </div> : null}
    {result === null ? <p role="status" className="p-2 text-muted-foreground">{t("Loading diff…")}</p>
      : result.status !== 'ready' ? <div role="status" className="flex flex-wrap items-center gap-2 p-2">
        <span>{INLINE_DIFF_UNAVAILABLE[result.status]}</span><Button variant="outline" size="sm" onClick={retry}>{t("Retry")}</Button>
      </div> : <>
        {patch && patch !== '@@' ? <div className="max-h-80 overflow-auto"><DiffView patch={patch} path={path} /></div>
          : !result.truncated ? <p className="p-2 text-muted-foreground">{t("No net workspace text changes in this turn.")}</p> : null}
        {result.truncated ? <p className="p-2 text-muted-foreground">{t("Preview truncated. Open the diff in the editor to see more.")}</p> : null}
      </>}
  </section>;
}
