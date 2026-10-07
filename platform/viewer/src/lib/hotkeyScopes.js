// Scope guards for hotkeys (see HotkeysManager.setScopeGuard). A guard answers "may this keypress
// act right now"; when it says no the key is left to the browser.

// Open modal or dialog, whichever of the viewer's dialog systems produced it: react-modal
// (UIModalService), ModalNG, Radix Dialog (ui-next), or anything declaring itself modal.
const MODAL_SELECTOR = '.ReactModal__Overlay, .sonadorModal, [role="dialog"][data-state="open"], [aria-modal="true"]';

const INTERACTIVE_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);

const WIDGET_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
]);

export function isModalOpen(doc = document) {
  if (!doc) {
    return false;
  }

  if (doc.body && doc.body.classList && doc.body.classList.contains('ReactModal__Body--open')) {
    return true;
  }

  return !!(doc.querySelector && doc.querySelector(MODAL_SELECTOR));
}

/**
 * Whether the element is a control the user may be operating: typing, pressing, or choosing.
 */
export function isInteractiveElement(element) {
  if (!element || element === element.ownerDocument?.body) {
    return false;
  }

  const tag = (element.tagName || '').toUpperCase();
  if (INTERACTIVE_TAGS.has(tag) && !(tag === 'A' && !element.hasAttribute?.('href'))) {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  const role = element.getAttribute ? element.getAttribute('role') : null;
  return !!(role && WIDGET_ROLES.has(role));
}

/**
 * The `viewport` scope: the key may act when no modal is open and focus is not on a control, so
 * the viewer, not a dialog or a form field, is what the user is working in.
 */
export function viewportScopeGuard(event, doc = document) {
  if (isModalOpen(doc)) {
    return false;
  }

  const focused = (event && event.target && event.target.ownerDocument && event.target.ownerDocument.activeElement) || (doc && doc.activeElement);
  return !isInteractiveElement(focused);
}
