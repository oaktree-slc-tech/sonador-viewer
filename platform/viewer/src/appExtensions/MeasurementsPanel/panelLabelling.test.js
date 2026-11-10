// The Measurements panel's Relabel and Edit description open the labelling flow for the row's
// measurement whichever viewport is active: with the MPR view active there is no classic element.

jest.mock('../../App', () => ({ commandsManager: {} }));
jest.mock('./jumpToRowItem.js', () => () => {});
// No classic viewport element is enabled (the MPR view)
jest.mock('cornerstone-core', () => ({ getEnabledElements: () => [] }), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('@ohif/ui', () => ({ MeasurementTable: () => null }));
const mockTools = { Length: [{ _id: 'len-1', toolType: 'Length', location: 'Femur', description: 'Pre-op' }] };
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    log: { warn: () => {}, error: () => {}, info: () => {} },
    redux: { actions: {} },
    measurements: { MeasurementApi: { _getToolType: row => row.toolType, Instance: { tools: mockTools } } },
    display: { DisplaySetApi: {} },
  },
  DICOMSR: { isToolSupported: () => true, Enums: { TOOL_NAMES: {} }, SREnums: { TOOL_NAMES: {} } },
  DicomMetadataStore: {},
  displayAttributes: {},
}));

const { mapDispatchToProps } = require('./ConnectedMeasurementTable');

const event = { persist: () => {} };
const row = { toolType: 'Length', measurementId: 'len-1' };
const viewports = { activeViewportIndex: 1 };

it('relabels the row\'s measurement without a classic element, starting with no location', () => {
  const onRelabel = jest.fn();
  mapDispatchToProps(jest.fn(), { onRelabel }).dispatchRelabel(event, row, viewports);
  expect(onRelabel).toHaveBeenCalledWith(expect.objectContaining({ _id: 'len-1', location: null, description: 'Pre-op' }));
});

it('edits the description of the row\'s measurement without a classic element', () => {
  const onEditDescription = jest.fn();
  mapDispatchToProps(jest.fn(), { onEditDescription }).dispatchEditDescription(event, row, viewports);
  expect(onEditDescription).toHaveBeenCalledWith(mockTools.Length[0]);
});

it('opens nothing for a row whose measurement the API does not hold', () => {
  const onRelabel = jest.fn();
  mapDispatchToProps(jest.fn(), { onRelabel }).dispatchRelabel(event, { toolType: 'Angle', measurementId: 'x' }, viewports);
  expect(onRelabel).not.toHaveBeenCalled();
});
