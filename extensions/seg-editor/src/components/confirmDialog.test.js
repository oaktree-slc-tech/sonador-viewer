// The confirmation dialog (Remove selected points, Discard Segmentation, Open as Segmentation):
// its keyboard handling and the answer it resolves, with and without a "don't ask again" checkbox

import { callConfirmDialog, confirmDialogKeyAction } from './confirmDialog';

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

describe('callConfirmDialog', () => {
  function service() {
    const uiDialogService = { show: jest.fn(), dismiss: jest.fn() };
    const props = () => uiDialogService.show.mock.calls[0][0].contentProps;
    return { uiDialogService, props };
  }

  it('resolves a plain answer without a suppression checkbox', async () => {
    const { uiDialogService, props } = service();
    const answer = callConfirmDialog({
      uiDialogService, id: 'd', title: 't', message: 'm', confirmText: 'Yes', cancelText: 'No',
    });

    expect(props().suppressionLabel).toBeUndefined();
    props().onConfirm({ suppressed: false });
    await expect(answer).resolves.toBe(true);
    expect(uiDialogService.dismiss).toHaveBeenCalledWith({ id: 'd' });
  });

  it('resolves the answer and the checkbox with a suppression label', async () => {
    const { uiDialogService, props } = service();
    const answer = callConfirmDialog({
      uiDialogService, id: 'd', title: 't', message: 'm', confirmText: 'Yes', cancelText: 'No',
      suppressionLabel: "Don't ask again",
    });

    expect(props()).toEqual(expect.objectContaining({
      suppressionLabel: "Don't ask again", suppressionId: 'd-suppress',
    }));
    props().onConfirm({ suppressed: true });
    await expect(answer).resolves.toEqual({ confirmed: true, suppressed: true });
  });

  it('never reports suppression on cancel, and settles once', async () => {
    const { uiDialogService, props } = service();
    const answer = callConfirmDialog({
      uiDialogService, id: 'd', title: 't', message: 'm', confirmText: 'Yes', cancelText: 'No',
      suppressionLabel: "Don't ask again",
    });

    props().onCancel({ suppressed: true });
    props().onConfirm({ suppressed: true });
    await expect(answer).resolves.toEqual({ confirmed: false, suppressed: false });
    expect(uiDialogService.dismiss).toHaveBeenCalledTimes(1);
  });
});
