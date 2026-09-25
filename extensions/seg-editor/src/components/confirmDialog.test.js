// Keyboard handling of the confirmation dialog (Remove selected points, Discard Segmentation)

import { confirmDialogKeyAction } from './confirmDialog';

jest.mock('@ohif/ui', () => ({ SimpleDialogShell: () => null }), { virtual: true });
jest.mock('@ohif/ui-next', () => ({ FooterAction: () => null }), { virtual: true });

const body = { tagName: 'BODY' };
const doc = { body, documentElement: { tagName: 'HTML' } };
body.ownerDocument = doc;
const element = (tagName, { inButton = false, className } = {}) => ({
  tagName,
  ownerDocument: doc,
  getAttribute: () => null,
  closest: selector => ((inButton && selector.includes('button'))
    || (className && selector.includes(`.${className}`)) ? {} : null),
});

describe('confirmDialogKeyAction', () => {
  it('Escape cancels, wherever focus is', () => {
    expect(confirmDialogKeyAction({ key: 'Escape', target: element('BUTTON') })).toBe('cancel');
    expect(confirmDialogKeyAction({ key: 'Escape', target: body })).toBe('cancel');
  });

  it('leaves Enter on a focused control to that control (Cancel cancels, primary confirms once)', () => {
    expect(confirmDialogKeyAction({ key: 'Enter', target: element('BUTTON') })).toBeNull();
    expect(confirmDialogKeyAction({ key: 'Enter', target: element('SPAN', { inButton: true }) })).toBeNull();
    expect(confirmDialogKeyAction({ key: 'Enter', target: element('SPAN', { className: 'closeBtn' }) })).toBeNull();
  });

  it('confirms on Enter when nothing has focus, or the dialog text has', () => {
    const text = element('DIV');
    const root = { contains: target => target === text };
    expect(confirmDialogKeyAction({ key: 'Enter', target: body }, root)).toBe('confirm');
    expect(confirmDialogKeyAction({ key: 'Enter', target: text }, root)).toBe('confirm');
  });

  it('ignores Enter aimed at something outside the dialog, and other keys', () => {
    const root = { contains: () => false };
    expect(confirmDialogKeyAction({ key: 'Enter', target: element('DIV') }, root)).toBeNull();
    expect(confirmDialogKeyAction({ key: 'a', target: body }, root)).toBeNull();
  });
});
