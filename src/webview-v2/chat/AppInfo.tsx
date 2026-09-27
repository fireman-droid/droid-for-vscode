import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { copyText } from '../bridge/clipboard';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { PinwheelIcon } from '@droidvisx/chat-ui/ui/pinwheel-icon';

declare const __DVX_VERSION__: string;
declare const __DVX_BUILD_ID__: string;

const version = typeof __DVX_VERSION__ === 'undefined' ? 'development' : __DVX_VERSION__;
const buildId = typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__;

export function AppInfo() {
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="plain" size="none" aria-label="About Droid" title="About Droid"
        className="-ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-1 text-[13px] font-semibold tracking-[-0.01em]">
        <PinwheelIcon className="size-4 shrink-0" />Droid
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="w-72 rounded-xl p-0" aria-label="About Droid">
      <AppInfoDetails />
    </PopoverContent>
  </Popover>;
}

function AppInfoDetails() {
  const hintId = useId();
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = setTimeout(() => setCopyState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  const copy = async () => {
    if (copyState === 'copying') return;
    setCopyState('copying');
    try {
      await copyText(`Droid\nVersion: ${version}\nBuild: ${buildId}`);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  return <>
    <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/50">
        <PinwheelIcon className="size-5" />
      </span>
      <div>
        <h2 className="text-[13px] font-semibold text-foreground">Droid</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">Extension information</p>
      </div>
    </div>
    <div className="px-4 pb-3">
      <dl className="space-y-3 rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Version</dt>
          <dd className="min-w-0 select-text break-all font-mono font-medium text-foreground">{version}</dd>
        </div>
        <div className="space-y-1.5 border-t border-border pt-2.5">
          <dt className="text-muted-foreground">Build</dt>
          <dd className="select-text break-all font-mono text-[11px] leading-relaxed text-foreground">{buildId}</dd>
        </div>
      </dl>
    </div>
    <div className="space-y-2 border-t border-border px-4 py-3">
      <Button variant="outline" size="sm" className="h-8 w-full"
        disabled={copyState === 'copying'} aria-describedby={hintId} onClick={() => { void copy(); }}>
        {copyState === 'copied' ? <Check aria-hidden="true" /> : copyState === 'copying'
          ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <Copy aria-hidden="true" />}
        {copyState === 'copied' ? 'Copied' : copyState === 'copying' ? 'Copying…' : 'Copy version info'}
      </Button>
      <p id={hintId} role="status" className={`text-[11px] leading-relaxed ${copyState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {copyState === 'error' ? 'Could not copy. Select the details above to copy manually.'
          : copyState === 'copied' ? 'Version and build copied to clipboard.' : 'Include these details when reporting an issue.'}
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        After updating, run <span className="font-medium text-foreground">Reload Window</span> from the Command Palette.
      </p>
    </div>
  </>;
}
