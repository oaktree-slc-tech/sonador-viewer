// The Save Measurements command refuses a save while a defined timepoint is active, before its
// dialog opens and again on submit (the selection can change while the dialog is open), and keeps the
// name of a refusal the API raises while the save runs. Every refusal settles the command's Promise
// with the same machine-readable name and the title the notification shows; nothing is stored.

const mockApi = { canCreate: true, canCreateAnnotations: () => mockApi.canCreate, storeMeasurements: jest.fn() };
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ import: () => () => {} }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    sonador: { getActiveServer: servers => servers[0], fetchServerSystemInfo: () => Promise.resolve({ ok: false }) },
    measurements: {
      MeasurementApi: { get Instance() { return mockApi; } },
      Enums: { TIMEPOINT_ERRORS: { SAVE_REFUSED: 'TimepointSaveRefused' } },
    },
    DICOMSR: { resolvePersonObserverName: () => Promise.resolve(null), saveResultSummary: (result, name) => ({ title: 'STOW SR', message: `${name}: stored`, result }) },
    display: {},
    log: { warn: () => {}, debug: () => {}, info: () => {} },
    utils: {},
    redux: { actions: {} },
  },
}), { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: {} }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
jest.mock('./state', () => ({ getEnabledElement: () => undefined }));
jest.mock('./tools/imagePlaneOf', () => ({ __esModule: true, default: () => undefined }));

import commandsModule from './commandsModule';

const dialogs = [];
const UIDialogService = { dismiss: jest.fn(), create: dialog => dialogs.push(dialog) };
const { definitions } = commandsModule({ servicesManager: { services: { UIDialogService, UINotificationService: { show: jest.fn() } } }, commandsManager: {} });
const save = () => definitions.saveMeasurements.commandFn({ viewports: {}, servers: { servers: [{ name: 'Synthetic', active: true, rootUrl: 'http://x' }] }, seriesNumber: 42 });
const submit = () => dialogs[dialogs.length - 1].contentProps.onUpdate({ SeriesNumber: 42, SeriesDescription: 'Measurements' });
const REFUSED = { name: 'TimepointSaveRefused', title: 'Measurements not saved' };

beforeEach(() => {
  dialogs.length = 0;
  mockApi.canCreate = true;
  mockApi.storeMeasurements.mockReset();
});

it('refuses before the dialog opens while a defined timepoint is active', async () => {
  mockApi.canCreate = false;
  await expect(save()).rejects.toMatchObject({ ...REFUSED, message: expect.stringContaining('review only') });
  expect(dialogs).toHaveLength(0);
  expect(mockApi.storeMeasurements).not.toHaveBeenCalled();
});

it('refuses on submit when the selection changed while the dialog was open', async () => {
  const promise = save();
  expect(dialogs).toHaveLength(1);
  mockApi.canCreate = false;
  await submit();
  await expect(promise).rejects.toMatchObject(REFUSED);
  expect(mockApi.storeMeasurements).not.toHaveBeenCalled();
});

it('keeps the name of a refusal the API raises while the save runs, with the title', async () => {
  const refusal = Object.assign(new Error('The active timepoint is shown for review only: nothing is saved while it is active.'), { name: 'TimepointSaveRefused' });
  mockApi.storeMeasurements.mockImplementation(() => Promise.reject(refusal));
  const promise = save();
  await submit();
  await expect(promise).rejects.toMatchObject({ ...REFUSED, message: refusal.message });
});

it('reports another store failure without a refusal name, and resolves a stored report', async () => {
  mockApi.storeMeasurements.mockImplementation(() => Promise.reject(new Error('upload failed')));
  const failed = save();
  await submit();
  await expect(failed).rejects.toMatchObject({ title: 'Measurements not saved', message: 'upload failed' });
  await expect(failed).rejects.not.toMatchObject({ name: 'TimepointSaveRefused' });

  mockApi.storeMeasurements.mockImplementation((timepointId, options) => { options.success({ stored: 1 }); return Promise.resolve({ stored: 1 }); });
  const stored = save();
  await submit();
  await expect(stored).resolves.toMatchObject({ title: 'STOW SR', message: 'Synthetic: stored' });
});
