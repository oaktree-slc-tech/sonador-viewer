import { isInteractiveElement, isModalOpen, viewportScopeGuard } from './hotkeyScopes';

const element = ({ tag = 'DIV', role = null, href = null, editable = false, body = false } = {}) => {
  const el = {
    tagName: tag,
    isContentEditable: editable,
    getAttribute: name => (name === 'role' ? role : null),
    hasAttribute: name => name === 'href' && href !== null,
  };
  el.ownerDocument = { body: body ? el : {} };
  return el;
};

const doc = ({ open = false, bodyOpen = false, active = null } = {}) => ({
  body: { classList: { contains: cls => bodyOpen && cls === 'ReactModal__Body--open' } },
  querySelector: () => (open ? {} : null),
  activeElement: active,
});

describe('isModalOpen', () => {
  it('detects any of the dialog systems', () => {
    expect(isModalOpen(doc({ open: true }))).toBe(true);
    expect(isModalOpen(doc({ bodyOpen: true }))).toBe(true);
    expect(isModalOpen(doc())).toBe(false);
    expect(isModalOpen(null)).toBe(false);
  });
});

describe('isInteractiveElement', () => {
  it('recognises form fields, buttons, links with an href, editable regions and widget roles', () => {
    expect(isInteractiveElement(element({ tag: 'INPUT' }))).toBe(true);
    expect(isInteractiveElement(element({ tag: 'BUTTON' }))).toBe(true);
    expect(isInteractiveElement(element({ tag: 'A', href: '/x' }))).toBe(true);
    expect(isInteractiveElement(element({ editable: true }))).toBe(true);
    expect(isInteractiveElement(element({ role: 'listbox' }))).toBe(true);
  });

  it('treats the body, plain containers and anchors without href as non-interactive', () => {
    expect(isInteractiveElement(element({ body: true }))).toBe(false);
    expect(isInteractiveElement(element())).toBe(false);
    expect(isInteractiveElement(element({ tag: 'A' }))).toBe(false);
    expect(isInteractiveElement(null)).toBe(false);
  });
});

describe('viewportScopeGuard', () => {
  it('allows the key when nothing modal is open and focus is on a container', () => {
    expect(viewportScopeGuard({}, doc({ active: element() }))).toBe(true);
    expect(viewportScopeGuard({}, doc({ active: null }))).toBe(true);
  });

  it('refuses while a modal is open', () => {
    expect(viewportScopeGuard({}, doc({ open: true, active: element() }))).toBe(false);
  });

  it('refuses while a control has focus', () => {
    expect(viewportScopeGuard({}, doc({ active: element({ tag: 'INPUT' }) }))).toBe(false);
    expect(viewportScopeGuard({}, doc({ active: element({ tag: 'BUTTON' }) }))).toBe(false);
    expect(viewportScopeGuard({}, doc({ active: element({ role: 'button' }) }))).toBe(false);
  });

  it('reads the focused element from the event target document when present', () => {
    const active = element({ tag: 'TEXTAREA' });
    const event = { target: { ownerDocument: { activeElement: active } } };

    expect(viewportScopeGuard(event, doc({ active: element() }))).toBe(false);
  });
});
