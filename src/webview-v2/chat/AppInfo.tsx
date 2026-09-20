import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';

declare const __DVX_VERSION__: string;
declare const __DVX_BUILD_ID__: string;

const version = typeof __DVX_VERSION__ === 'undefined' ? 'development' : __DVX_VERSION__;
const buildId = typeof __DVX_BUILD_ID__ === 'undefined' ? 'development' : __DVX_BUILD_ID__;

export function AppInfo() {
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="plain" size="none" aria-label="About DroidVisX" title="About DroidVisX"
        className="rounded-sm text-[13px] font-semibold tracking-[-0.01em]">Droid</Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72 space-y-3 p-3" aria-label="DroidVisX version information">
      <p className="text-xs font-medium">DroidVisX</p>
      <dl className="space-y-2 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Version</dt><dd className="select-text">{version}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">Build</dt>
          <dd className="select-text break-all font-mono text-[11px]">{buildId}</dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Include this version and build when reporting an issue. After installing an update, use Reload Window to load it.
      </p>
    </PopoverContent>
  </Popover>;
}
