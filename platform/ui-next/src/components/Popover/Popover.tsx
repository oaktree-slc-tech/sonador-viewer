import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';

import { cn } from '../../lib/utils';


const Popover = PopoverPrimitive.Root;


/**
 * The element the popover is anchored to AND the element focus returns to when the popover closes.
 *
 * Both matter. Radix restores focus through `context.triggerRef`, which only PopoverTrigger
 * populates — a bare PopoverAnchor positions the content but leaves Escape-to-close with focus
 * stranded wherever it was. Use `asChild` to make an existing interactive element (a link, a
 * button) the trigger rather than nesting a button inside it.
 */
const PopoverTrigger = PopoverPrimitive.Trigger;


/**
 * Positions the content against an element other than the trigger. Optional: with no anchor the
 * content is positioned against the trigger, which is what most consumers want.
 */
const PopoverAnchor = PopoverPrimitive.Anchor;


/**
 * Renders the popover into document.body (or `container`) instead of beside its trigger.
 *
 * Required whenever the trigger sits inside a clipping ancestor — an `overflow: auto` scroll
 * container, a styled table — because in place the content is a descendant of that element and is
 * both clipped by it and reached by its descendant rules. Mirrors HoverCardPortal.
 */
const PopoverPortal = PopoverPrimitive.Portal;


/**
 * Content surface, with the same chrome as DropdownMenuContent -- popover background, one-unit
 * padding, the shared overlay outline, `rounded`, `shadow-md`, `min-w-[8rem]`. A popover and a
 * dropdown are the same kind of floating panel to a user, so they should not arrive at different
 * sizes and paddings depending on which primitive a component happened to reach for.
 *
 * Padding in particular is deliberately small rather than absent: a consumer that wants different
 * spacing sets it on its own rows, and does not have to win a specificity fight with a `p-4` here.
 * That fight is not winnable by inspection anyway -- this build emits Tailwind utilities unlayered,
 * so a CSS-module class and a utility of equal specificity are settled by stylesheet order.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      'bg-popover text-popover-foreground border-overlay-line z-50 min-w-[8rem] rounded border p-1 shadow-md outline-none',
      'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      className
    )}
    {...props}
  />
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;


export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent, PopoverPortal };
