import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import type { PermissionInteractionRequest } from '../../shared/protocol/interactions';
import { isNegativePermissionOption } from '../../webview/assistant/interactions/permissionPresentation';
import { Button } from '../ui/button';

export function PermissionOptions({ options, plan, disabled, onSelect }: {
  readonly options: PermissionInteractionRequest['options'];
  readonly plan: boolean;
  readonly disabled: (option: PermissionInteractionRequest['options'][number]) => boolean;
  readonly onSelect: (option: PermissionInteractionRequest['options'][number]) => void;
}) {
  const separate = options.filter((option) => isNegativePermissionOption(option) || plan && option.requiresEditedSpec);
  const positive = options.filter((option) => !separate.includes(option));
  const primary = positive[0];
  return <div className="flex flex-wrap items-center justify-end gap-1.5 [&>button]:h-7 [&>button]:px-2.5 [&>button]:text-[11px]">
    {separate.map((option, index) => <Button key={option.value} variant="outline" className={index === 0 && isNegativePermissionOption(option) ? 'mr-auto' : undefined} disabled={disabled(option)} onClick={() => onSelect(option)}>{option.label}</Button>)}
    {primary ? <div className="flex overflow-hidden rounded-md">
      <Button className={`h-7 px-2.5 text-[11px] ${positive.length > 1 ? 'rounded-r-none' : ''}`} disabled={disabled(primary)} onClick={() => onSelect(primary)}>{plan ? 'Approve plan' : primary.label}</Button>
      {positive.length > 1 ? <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button size="icon-sm" className="size-7 rounded-l-none border-l border-primary-foreground/30" aria-label={plan ? 'More plan approval options' : 'More permission options'} disabled={positive.slice(1).every(disabled)}><ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-64">
          {positive.slice(1).map((option) => <DropdownMenuItem key={option.value} disabled={disabled(option)} onSelect={() => onSelect(option)}>{option.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu> : null}
    </div> : null}
  </div>;
}
