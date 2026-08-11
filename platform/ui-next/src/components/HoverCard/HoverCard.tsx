import * as React from 'react';
import * as HoverCardPrimitive from '@radix-ui/react-hover-card';

import { cn } from '../../lib/utils';


const HoverCard = HoverCardPrimitive.Root;


const HoverCardTrigger = HoverCardPrimitive.Trigger;


/**
 * Renders the card into document.body instead of beside its trigger.
 *
 * HoverCardContent is deliberately left un-portaled by default (existing consumers position it
 * within their own stacking context), but a trigger inside a styled table or a clipping scroll
 * container needs this: in place, the card is a descendant of those elements, so descendant rules
 * such as `.row td { ... }` reach the card's own cells and an `overflow: auto` ancestor clips it.
 */
const HoverCardPortal = HoverCardPrimitive.Portal;


const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      'bg-muted text-muted-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 border-overlay-line z-50 w-64 rounded-md border p-4 shadow-md outline-none',
      className
    )}
    {...props}
  />
));
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName;


export { HoverCard, HoverCardTrigger, HoverCardContent, HoverCardPortal };