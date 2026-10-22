import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({ className, align = 'end', ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-[180px] rounded-lg border border-line bg-white p-1 shadow-pop data-[state=open]:animate-scale-in', className)}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ className, inset, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> & { inset?: boolean }) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-ink-800 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-slate-100 data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-ink-500',
        inset && 'pl-8',
        className,
      )}
      {...props}
    />
  );
}

export function MenuCheckItem({ checked, children, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> & { checked: boolean }) {
  return (
    <MenuItem {...props}>
      <span className="flex size-4 items-center justify-center">{checked && <Check className="!text-brand-600" />}</span>
      {children}
    </MenuItem>
  );
}

export function MenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn('px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-400', className)} {...props} />;
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-line" />;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverClose = PopoverPrimitive.Close;
export function PopoverContent({ className, align = 'start', ...props }: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 rounded-lg border border-line bg-white shadow-pop focus:outline-none data-[state=open]:animate-scale-in', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ content, children, side = 'top' }: { content: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow-pop data-[state=delayed-open]:animate-fade-in">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
