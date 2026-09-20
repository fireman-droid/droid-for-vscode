import { RadioGroup as RadioPrimitive, Slider as SliderPrimitive, Switch as SwitchPrimitive, ToggleGroup as TogglePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { buttonVariants } from './button';

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return <RadioPrimitive.Root className={cn('grid select-none gap-1', className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioPrimitive.Item>) {
  return <RadioPrimitive.Item className={cn('dvx-control dvx-choice flex size-3.5 shrink-0 items-center justify-center rounded-full border bg-input-background disabled:opacity-45 data-[state=checked]:border-primary', className)} {...props}>
    <RadioPrimitive.Indicator className="dvx-choice-indicator size-1.5 rounded-full bg-primary" />
  </RadioPrimitive.Item>;
}

export const ToggleGroup = TogglePrimitive.Root;
export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof TogglePrimitive.Item>) {
  return <TogglePrimitive.Item className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'data-[state=on]:bg-secondary data-[state=on]:text-foreground', className)} {...props} />;
}

export function Slider({ className, 'aria-label': label, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return <SliderPrimitive.Root className={cn('relative flex touch-none select-none items-center data-[disabled]:opacity-45', className)} {...props}>
    <SliderPrimitive.Track className="relative h-1 w-full grow rounded-full bg-secondary">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb aria-label={label} className="dvx-control dvx-choice dvx-slider-thumb block size-3 rounded-full border bg-background" />
  </SliderPrimitive.Root>;
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return <SwitchPrimitive.Root className={cn('dvx-control dvx-choice inline-flex h-[17px] w-[29px] shrink-0 items-center rounded-full border bg-muted px-0.5 disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary', className)} {...props}>
    <SwitchPrimitive.Thumb className="dvx-switch-thumb block size-[11px] rounded-full bg-muted-foreground shadow-sm data-[state=checked]:translate-x-3 data-[state=checked]:bg-primary-foreground" />
  </SwitchPrimitive.Root>;
}
