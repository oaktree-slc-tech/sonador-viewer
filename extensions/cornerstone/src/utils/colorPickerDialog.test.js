// The color picker dialog every color choice opens (segments, models, measurement line and text
// colors): centred over an overlay and not draggable, resolving the chosen color.

jest.mock('react-color', () => ({ ChromePicker: () => null }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SimpleDialogShell: ({ children }) => children }), { virtual: true });
jest.mock('@ohif/ui-next', () => ({ FooterAction: () => null }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    displayAttributes: jest.requireActual('../../../../platform/core/src/displayAttributes'),
    utils: { color: jest.requireActual('../../../../platform/core/src/utils/colors').default },
  },
}), { virtual: true });

import { callColorPickerDialog } from './colorPickerDialog';

const dialogService = () => ({ show: jest.fn(), dismiss: jest.fn() });

it('opens the dialog centred, over an overlay, not draggable, and resolves the chosen color', async () => {
  const uiDialogService = dialogService();
  const picked = callColorPickerDialog({ uiDialogService, value: '#FF8800', title: 'Line Color' });

  const [dialog] = uiDialogService.show.mock.calls[0];
  expect(dialog).toMatchObject({ centralize: true, isDraggable: false, showOverlay: true, title: 'Line Color' });
  expect(dialog.contentProps.value).toBe('#FF8800');

  dialog.contentProps.onSave({ r: 255, g: 136, b: 0, a: 1 });
  await expect(picked).resolves.toEqual({ r: 255, g: 136, b: 0, a: 1 });
});

it('lets a caller override the placement', () => {
  const uiDialogService = dialogService();
  callColorPickerDialog({ uiDialogService, isDraggable: true });
  expect(uiDialogService.show.mock.calls[0][0].isDraggable).toBe(true);
});

it('passes a palette to the picker and offers the reset button only when asked, resolving null for it', async () => {
  const uiDialogService = dialogService();
  const palette = [{ name: 'Primary', hex: '#348CFD' }];
  const picked = callColorPickerDialog({ uiDialogService, palette, allowReset: true });
  const { contentProps } = uiDialogService.show.mock.calls[0][0];
  expect(contentProps.palette).toBe(palette);
  contentProps.onReset();
  await expect(picked).resolves.toBeNull();

  const other = dialogService();
  callColorPickerDialog({ uiDialogService: other });
  expect(other.show.mock.calls[0][0].contentProps).not.toHaveProperty('onReset');
  expect(other.show.mock.calls[0][0].contentProps.palette).toBeUndefined();
});
