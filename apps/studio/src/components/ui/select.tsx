import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // The value span truncates instead of wrapping: a long option name (a query called "AMR
      // cumulative antibiogram (fixed panel)") grew the trigger to two lines and broke the row
      // height everywhere the pane is narrow. min-w-0 is what lets a flex child shrink at all.
      'flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 [&>span]:min-w-0 [&>span]:truncate',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = 'SelectTrigger';

/** ⛔ A LONG LIST USED TO BE UNREACHABLE, and both halves of the fix are load-bearing.
 *
 *  This had `overflow-hidden` and NO height bound at all, so a Select with more items than fit on
 *  screen simply grew past the viewport and had its overflow clipped away. Measured on the facility
 *  import column map, whose Select carries the 16 contract fields plus "Not mapped": on a phone the
 *  list opened part-way down its own contents and the first several fields could not be reached by
 *  any means. `--radix-select-content-available-height` is Radix's own measurement of the room
 *  between the trigger and the viewport edge, so the list now bounds itself to what actually fits.
 *
 *  ⚠ THE SCROLL BUTTONS ARE NOT DECORATION. Select content is PORTALLED, and inside a Sheet or a
 *  Dialog `react-remove-scroll` permits scrolling only within that surface's own subtree, so a
 *  portalled list gets no wheel or touch scrolling. The same trap already bit a `PopoverContent`
 *  inside a Sheet in this app. Radix's scroll buttons move the viewport programmatically and are
 *  therefore the only thing that reaches the hidden items from inside a Sheet. `overflow-y-auto`
 *  below covers the ordinary page case where native scrolling does work. */
export const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = 'SelectScrollUpButton';

export const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = 'SelectScrollDownButton';

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem]',
        'overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto p-1">
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = 'SelectContent';

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator><Check className="h-4 w-4" /></SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = 'SelectItem';

export const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
));
SelectSeparator.displayName = 'SelectSeparator';
