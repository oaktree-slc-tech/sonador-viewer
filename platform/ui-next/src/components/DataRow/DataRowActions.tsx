import React, { useRef, useState } from 'react';
import { Button } from '../../components/Button/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../../components/DropdownMenu';
import { Icons } from '../../components/Icons/Icons';
import { cn } from '../../lib/utils';

/**
 * One item of a row's actions menu
 * @property {string} id - Stable key of the item
 * @property {string} label - Text of the item (already translated)
 * @property {React.ReactNode} icon - Icon shown before the label
 * @property {(e) => void} onClick - Called when the item is chosen; the row does not see the click
 * @property {string} [dataCY] - data-cy of the label
 */
export interface DataRowAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  dataCY?: string;
}

/**
 * The actions menu of a data row (the "more" button and its dropdown), shared by DataRow and the
 * rows of other panels. With no actions it keeps the button's place with a spacer, so the row's
 * other controls stay aligned. The button shows on the row's hover (its `group` ancestor), while
 * the row is selected, while it has keyboard focus, and while the menu is open. Closing the menu
 * without choosing an item (Escape, a click outside) returns focus to the button; choosing one
 * leaves focus to the action, which may open a dialog.
 */
interface DataRowActionsProps {
  actions: DataRowAction[];
  isSelected?: boolean;
  portalContainer?: HTMLElement | null;
  className?: string;
  /** Classes of the dropdown, for a panel whose theme does not reach the portalled menu */
  contentClassName?: string;
  ariaLabel?: string;
}

function DataRowActions({
  actions,
  isSelected = false,
  portalContainer,
  className,
  contentClassName,
  ariaLabel = 'Actions',
}: DataRowActionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Whether the menu is closing because an item was chosen
  const chosen = useRef(false);

  if (!actions || !actions.length) {
    return <div className={cn('h-6 w-6', className)}></div>;
  }

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) {
          chosen.current = false;
        }
        setIsOpen(open);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn(
            'h-6 w-6 transition-opacity',
            isSelected || isOpen ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
            className
          )}
          aria-label={ariaLabel}
          dataCY="actionsMenuTrigger"
          onClick={e => e.stopPropagation()} // Prevent row selection on button click
        >
          <Icons.More className="h-6 w-6" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        container={portalContainer}
        className={contentClassName}
        // An action may open a dialog, which takes focus; otherwise focus returns to the button
        onCloseAutoFocus={e => {
          if (chosen.current) {
            e.preventDefault();
            chosen.current = false;
          }
        }}
      >
        {actions.map(action => (
          <DropdownMenuItem
            key={action.id}
            onClick={e => {
              e.stopPropagation();
              chosen.current = true;
              action.onClick(e);
            }}
          >
            {action.icon}
            <span
              className="pl-2"
              data-cy={action.dataCY}
            >
              {action.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { DataRowActions };
export type { DataRowActionsProps };
