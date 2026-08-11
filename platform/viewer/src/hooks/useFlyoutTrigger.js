// Shared open/close controller for the sidebar's flyout surfaces (ohif-viewers#128).
//
// One implementation, used by both the navigation flyouts and the narrow-mode server picker, so
// the trigger semantics cannot drift between them. It returns props to spread onto a Radix
// PopoverAnchor (the trigger) and onto the PopoverContent, plus the controlled `open` pair.
//
// Why a hook and not Radix's own trigger semantics:
//
//   * Radix `HoverCard` opens on hover but has no touch path at all.
//   * Radix `NavigationMenu` has exactly the semantics wanted — hover on a mouse, tap on touch —
//     but exports no Portal, so its flyout is clipped by `.ngSidebar { overflow: auto }`.
//   * Radix `Popover` portals and collision-detects correctly but opens only on click.
//
// So: Popover for the surface, and NavigationMenu's own `whenMouse` guard (lifted verbatim below)
// for the trigger.
//
// The trigger is a PopoverAnchor rather than a PopoverTrigger because in `full` mode the row is a
// NavLink that must navigate on click — PopoverTrigger unconditionally composes an open-toggle into
// its onClick, and its `checkForDefaultPrevented` composition means a handler that preventDefaults
// the navigation also swallows the toggle. The cost of dropping PopoverTrigger is that Radix's
// focus restoration goes with it: `onCloseAutoFocus` restores through `context.triggerRef`, which
// only PopoverTrigger populates. Escape-returns-focus (FR-13) is therefore handled here, against
// the ref this hook hands back.

import { useCallback, useEffect, useRef, useState } from 'react';

/** Pointer-enter opens after this long, so travelling past a trigger does not flash a flyout. */
const OPEN_DELAY_MS = 150;

/**
 * Pointer-leave closes after this long. Long enough to cross the gap between the trigger and the
 * flyout diagonally, which is the travel a straight trigger-to-content hairline would break.
 */
const CLOSE_DELAY_MS = 250;

/**
 * Verbatim from @radix-ui/react-navigation-menu: run the handler for mouse pointers only. Touch
 * and pen fire pointerenter on tap, which would make "hover to open" indistinguishable from a tap
 * and leave the flyout stuck open on touch devices.
 */
const whenMouse = (handler) => (event) =>
  event.pointerType === 'mouse' ? handler(event) : undefined;

/** An open the flyout arrived at on its own, rather than one the user asked for. */
const isIncidental = (reason) => reason === 'hover' || reason === 'focus';

/**
 * What a deliberate activation of a `menu` trigger -- a click, a tap, or Enter/Space -- should do,
 * given what the flyout is currently doing and why.
 *
 * Exported and pure because this is the part that is easy to get wrong by reasoning alone: the
 * trigger both opens on focus and toggles on activation, and those two fight unless the incidental
 * opens are excluded from toggling. Tabbing to a trigger opens the flyout, so a naive toggle made
 * the first Enter/Space close it instead of entering it; a single tap did the same thing, opening
 * on focus and closing again on click.
 *
 * `focusContent` is only ever true for a keyboard activation of an ALREADY-open flyout. When the
 * activation opens it, Radix's onOpenAutoFocus does the focusing on mount instead; nothing fires
 * when it is already open, so focus has to be placed by hand.
 */
export function resolveActivation({ open, openReason, keyboard }) {
  const reason = keyboard ? 'activate-keyboard' : 'activate-pointer';

  if (open && isIncidental(openReason)) {
    return { open: true, reason, focusContent: keyboard };
  }

  if (open) {
    return { open: false, reason: openReason, focusContent: false };
  }

  return { open: true, reason, focusContent: false };
}

export default function useFlyoutTrigger({ activation = 'link' } = {}) {
  const [open, setOpen] = useState(false);

  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const timerRef = useRef(null);

  // Why the flyout is open, which decides two different things.
  //
  // 'hover' and 'focus' are INCIDENTAL: the flyout followed the pointer or the focus ring, the user
  // did not ask for it. 'activate-pointer' and 'activate-keyboard' are DELIBERATE: a click, a tap,
  // or Enter/Space.
  //
  // Only a deliberate keyboard activation may move focus into the flyout (FR-12). And only a
  // deliberate open may be toggled shut by the next activation -- see resolveActivation above.
  const openReasonRef = useRef('hover');

  // Set while focus is being handed back to the trigger on dismissal, so the trigger's own onFocus
  // does not read that as the user arriving and reopen what was just closed.
  const suppressFocusOpenRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const openNow = useCallback(
    (reason) => {
      clearTimer();
      openReasonRef.current = reason;
      setOpen(true);
    },
    [clearTimer]
  );

  const closeNow = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  const scheduleOpen = useCallback(() => {
    clearTimer();
    openReasonRef.current = 'hover';
    timerRef.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  }, [clearTimer]);

  /** Hand focus back to the trigger without that being mistaken for the user focusing it. */
  const returnFocusToTrigger = useCallback(() => {
    suppressFocusOpenRef.current = true;

    try {
      triggerRef.current?.focus();
    } finally {
      // focus() dispatches synchronously, so the guard is already spent by the time we get here.
      suppressFocusOpenRef.current = false;
    }
  }, []);

  /**
   * Move focus into the flyout. Radix does this itself through onOpenAutoFocus, but only on the
   * open transition -- when the flyout is already open (the trigger took focus first, which is
   * exactly the Tab-then-Enter case) nothing fires and focus has to be placed by hand.
   */
  const focusContent = useCallback(() => {
    const content = contentRef.current;

    if (!content) {
      return;
    }

    const first = content.querySelector(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    (first || content).focus();
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, [clearTimer]);

  const onOpenChange = useCallback(
    (nextOpen) => {
      clearTimer();
      setOpen(nextOpen);
    },
    [clearTimer]
  );

  const handleTriggerClick = useCallback(
    (event) => {
      if (activation !== 'menu') {
        // The trigger is a link and is navigating; the flyout has served its purpose.
        closeNow();
        return;
      }

      clearTimer();

      // A click with detail 0 was synthesised from Enter or Space rather than produced by a
      // pointer. That is the one case where activation carries focus into the flyout.
      const next = resolveActivation({
        open,
        openReason: openReasonRef.current,
        keyboard: event.detail === 0,
      });

      openReasonRef.current = next.reason;
      setOpen(next.open);

      if (next.focusContent) {
        focusContent();
      }
    },
    [activation, clearTimer, closeNow, focusContent, open]
  );

  const triggerProps = {
    ref: triggerRef,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    onPointerEnter: whenMouse(scheduleOpen),
    onPointerLeave: whenMouse(scheduleClose),
    onClick: handleTriggerClick,
    onFocus: () => {
      if (suppressFocusOpenRef.current) {
        return;
      }

      openNow('focus');
    },
  };

  const contentProps = {
    ref: contentRef,
    onPointerEnter: whenMouse(clearTimer),
    onPointerLeave: whenMouse(scheduleClose),

    // Hover- and focus-initiated opens leave focus where the user put it. Only a deliberate key
    // activation pulls focus into the flyout.
    onOpenAutoFocus: (event) => {
      if (openReasonRef.current !== 'activate-keyboard') {
        event.preventDefault();
      }
    },

    onEscapeKeyDown: () => {
      closeNow();
      returnFocusToTrigger();
    },

    // Radix treats a pointer-down on the trigger as "outside" the content and dismisses, which
    // would fight the trigger's own toggle. PopoverContent does this itself when it has a real
    // PopoverTrigger to compare against; with an anchor it has to be done here.
    onPointerDownOutside: (event) => {
      if (triggerRef.current?.contains(event.target)) {
        event.preventDefault();
      }
    },
  };

  return { open, onOpenChange, close: closeNow, triggerProps, contentProps };
}
