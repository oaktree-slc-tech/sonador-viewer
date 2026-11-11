// The labelling dialog of an out-of-plane measurement (a measurement-service record, no classic
// tool) writes the location and description it is given into the record and its metadata, where
// the Measurements panel and the writer read them, and updates the record through the service.

const mockUpdate = jest.fn();
const mockTableUpdate = jest.fn();
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('cornerstone-tools', () => ({ import: () => () => {} }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    measurements: {
      MeasurementApi: {
        Instance: { measurementService: { update: (...args) => mockUpdate(...args) } },
        _unpackMeasurementLabellingAttrs: m => ({ location: (m.metadata || {}).location || m.location, description: m.description }),
      },
      applyLabellingAttrs: jest.requireActual('../../../platform/core/src/measurements/lib/applyLabellingAttrs').default,
    },
    display: {},
    DICOMSR: { outOfPlane: jest.requireActual('../../../platform/core/src/DICOMSR/utils/outOfPlane') },
    log: { warn: () => {}, debug: () => {}, info: () => {} },
    utils: {},
    redux: { actions: {} },
  },
}), { virtual: true });
jest.mock('@ohif/sonador-viewer/src/store/useDicomHeadersOverlay', () => ({ useDicomHeadersOverlayStore: {} }), { virtual: true });
jest.mock('@ohif/ui', () => ({ SaveDicomSeriesDialog: () => null, workflow: { LabellingFlow: () => null } }), { virtual: true });
jest.mock('./utils/setCornerstoneLayout', () => jest.fn());
jest.mock('./CornerstoneViewportDownloadForm', () => () => null);
jest.mock('./state', () => ({ getEnabledElement: () => undefined }));

import commandsModule from './commandsModule';

const dialogs = [];
const UIDialogService = { dismiss: () => {}, create: dialog => dialogs.push(dialog) };
const { actions } = (() => {
  const commandsManager = { runCommand: (name, ...args) => name === 'updateTableWithNewMeasurementData' && mockTableUpdate(...args) };
  const module = commandsModule({ servicesManager: { services: { UIDialogService } }, commandsManager });
  return { actions: Object.fromEntries(Object.entries(module.definitions).map(([name, { commandFn }]) => [name, commandFn])) };
})();

beforeEach(() => {
  dialogs.length = 0;
  mockUpdate.mockClear();
  mockTableUpdate.mockClear();
});

it("writes an out-of-plane measurement's location and description into its record and metadata", () => {
  const record = {
    uid: 'oop-1', toolName: 'Length', points: [[12, 0, 0], [12, 30, -40]],
    metadata: { outOfPlane: true, location: 'Previous', views: ['sagittal'] },
  };
  actions.labellingDialog({ measurementData: record, dialogProps: { editLocation: true } });
  const [{ contentProps }] = dialogs;
  expect(contentProps.measurementData).toMatchObject({ location: 'Previous' });

  contentProps.updateLabelling({ location: 'Femoral neck' });
  contentProps.updateLabelling({ description: 'Neck length' });

  expect(mockTableUpdate).not.toHaveBeenCalled();
  const [uid, updated, notYetUpdatedAtSource] = mockUpdate.mock.calls[mockUpdate.mock.calls.length - 1];
  expect(uid).toBe('oop-1');
  expect(notYetUpdatedAtSource).toBe(true);
  expect(updated).toMatchObject({
    location: 'Femoral neck', description: 'Neck length',
    metadata: { outOfPlane: true, location: 'Femoral neck', description: 'Neck length', views: ['sagittal'] },
  });
});

it('updates a classic measurement through the table, as before', () => {
  const classic = { _id: 'c-1', toolType: 'Length', metadata: {} };
  actions.labellingDialog({ measurementData: classic });
  dialogs[0].contentProps.updateLabelling({ location: 'Femur' });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockTableUpdate).toHaveBeenCalledWith(expect.objectContaining({ location: 'Femur' }));
});
