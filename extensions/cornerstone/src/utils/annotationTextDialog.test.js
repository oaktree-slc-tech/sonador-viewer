// The arrow's labelling dialog: the classic tool and the Cornerstone3D tool take their label from the
// same dialog, centred over an overlay (above the modal for the Inspector). A cancelled new arrow gets
// an empty label, which both tools delete; a cancelled or empty edit keeps the label held.

jest.mock('@ohif/ui', () => ({ InputDialog: 'InputDialog' }), { virtual: true });

import { annotationTextCallbacks } from './annotationTextDialog';

function dialogService() {
  const service = { dialogs: [] };
  service.create = jest.fn((props) => {
    service.dialogs.push(props);
    return `dialog-${service.dialogs.length}`;
  });
  service.dismiss = jest.fn();
  return service;
}

it('labels a new arrow in the classic dialog, and gives an empty label when it is cancelled', () => {
  const service = dialogService();
  const { getTextCallback } = annotationTextCallbacks(service);
  const done = jest.fn();

  getTextCallback(done);
  const [dialog] = service.dialogs;
  expect(dialog).toMatchObject({ content: 'InputDialog', centralize: true, showOverlay: true, isDraggable: false, aboveModal: false });
  expect(dialog.contentProps).toMatchObject({ title: 'Enter your annotation', label: 'New label', defaultValue: '' });
  dialog.contentProps.onSubmit('Lesion margin');
  expect(done).toHaveBeenLastCalledWith('Lesion margin');
  expect(service.dismiss).toHaveBeenLastCalledWith({ id: 'dialog-1' });

  getTextCallback(done);
  service.dialogs[1].contentProps.onClose();
  expect(done).toHaveBeenLastCalledWith('');
  expect(service.dismiss).toHaveBeenLastCalledWith({ id: 'dialog-2' });
});

it('stacks the dialog above the modal for the Inspector', () => {
  const service = dialogService();
  annotationTextCallbacks(service, { aboveModal: true }).getTextCallback(jest.fn());
  expect(service.dialogs[0].aboveModal).toBe(true);
});

it.each([
  ['classic', { text: 'Lesion margin' }],
  ['Cornerstone3D', { annotationUID: 'a-1', data: { label: 'Lesion margin' } }],
])('edits the %s label it holds; a cancelled or empty edit keeps it', (kind, target) => {
  const service = dialogService();
  const { changeTextCallback } = annotationTextCallbacks(service);
  const done = jest.fn();

  changeTextCallback(target, {}, done);
  expect(service.dialogs[0].contentProps.defaultValue).toBe('Lesion margin');
  service.dialogs[0].contentProps.onSubmit('New label');
  expect(done).toHaveBeenLastCalledWith('New label');

  changeTextCallback(target, {}, done);
  service.dialogs[1].contentProps.onClose();
  expect(done).toHaveBeenLastCalledWith('Lesion margin');

  changeTextCallback(target, {}, done);
  service.dialogs[2].contentProps.onSubmit('');
  expect(done).toHaveBeenLastCalledWith('Lesion margin');
});
