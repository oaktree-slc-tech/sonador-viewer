// The flyout trigger's activation decision (ohif-viewers#128, FR-12).
//
// This covers the case the hook originally got wrong: the trigger opens on focus AND toggles on
// activation, and those two fight unless an incidental open is excluded from toggling. Tabbing to
// a narrow trigger opens the flyout, so a naive toggle made the first Enter/Space close it instead
// of moving focus into it, and a single tap opened on focus then closed again on click.
//
// The decision is unit-tested rather than driven through a rendered component: jest has no DOM
// environment here, so the browser-level half -- that a tap really does fire focus before click,
// and that focus really lands on the first row -- still needs exercising by hand.

import { resolveActivation } from './useFlyoutTrigger';

describe('resolveActivation', () => {
  describe('Tab to the trigger, then Enter/Space', () => {
    // Tab fires focus, which opens the flyout with reason 'focus'. Enter/Space arrives as a click
    // with detail 0 against an already-open flyout.
    const next = resolveActivation({ open: true, openReason: 'focus', keyboard: true });

    it('keeps the flyout open rather than toggling it shut', () => {
      expect(next.open).toBe(true);
    });

    it('moves focus into the flyout, which is what FR-12 asks of a keyboard activation', () => {
      expect(next.focusContent).toBe(true);
    });

    it('records the open as deliberate, so the next Enter/Space can close it', () => {
      expect(next.reason).toBe('activate-keyboard');

      const second = resolveActivation({ open: true, openReason: next.reason, keyboard: true });
      expect(second.open).toBe(false);
    });
  });

  describe('single tap on a touch device', () => {
    // A tap focuses the button before it clicks it, so the click also lands on an open flyout.
    const next = resolveActivation({ open: true, openReason: 'focus', keyboard: false });

    it('leaves the flyout open instead of opening and immediately closing it', () => {
      expect(next.open).toBe(true);
    });

    it('does not steal focus, which only a keyboard activation may do', () => {
      expect(next.focusContent).toBe(false);
    });

    it('is toggled shut by a second tap', () => {
      expect(resolveActivation({ open: true, openReason: next.reason, keyboard: false }).open)
        .toBe(false);
    });
  });

  describe('mouse: hover opens, then click', () => {
    it('commits to the hovered-open flyout rather than closing it under the cursor', () => {
      const next = resolveActivation({ open: true, openReason: 'hover', keyboard: false });

      expect(next.open).toBe(true);
      expect(next.reason).toBe('activate-pointer');
    });
  });

  describe('activating a closed flyout', () => {
    it('opens it', () => {
      expect(resolveActivation({ open: false, openReason: 'hover', keyboard: false }).open).toBe(true);
    });

    it('leaves the focus move to Radix onOpenAutoFocus, which fires on mount', () => {
      const next = resolveActivation({ open: false, openReason: 'hover', keyboard: true });

      expect(next.reason).toBe('activate-keyboard');
      expect(next.focusContent).toBe(false);
    });
  });
});
