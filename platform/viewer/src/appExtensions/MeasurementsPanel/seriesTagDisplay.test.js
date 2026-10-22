jest.mock('../../App', () => ({ commandsManager: {} }));
jest.mock('./jumpToRowItem.js', () => () => {});
jest.mock('cornerstone-core', () => ({}), { virtual: true });
jest.mock('@ohif/ui', () => ({ MeasurementTable: () => null }));
jest.mock('@ohif/core', () => {
  const displayAttributes = jest.requireActual('../../../../core/src/displayAttributes');
  const OHIF = {
    redux: { actions: {} },
    measurements: { MeasurementApi: {} },
    display: { DisplaySetApi: {} },
  };
  return {
    __esModule: true,
    default: OHIF,
    DICOMSR: { SREnums: { TOOL_NAMES: { DICOM_SR_SERIES_TAG: 'DICOMSRSeriesTagTool' } } },
    DicomMetadataStore: {},
    displayAttributes: displayAttributes.default,
  };
});

const { seriesTagDisplay } = require('./ConnectedMeasurementTable');
const { displayAttributes } = require('@ohif/core');

const TOOL = 'DICOMSRSeriesTagTool';
const finding = color => ({ value: 'RID1301', displayAttributes: color && { Color: color } });

afterEach(() => displayAttributes.setSiteDisplayAttributes(null));

describe('seriesTagDisplay', () => {
  it('ignores other tools', () => {
    expect(seriesTagDisplay('Length', {}, {}, {})).toBeUndefined();
  });

  it('uses the table colors for a finding with the default profile or no stored colors', () => {
    const defaults = { Background: null, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' };
    expect(seriesTagDisplay(TOOL, finding(defaults), { text: 'Lung' }, {})).toEqual({ color: {}, value: 'RID1301', meaning: 'Lung' });
    expect(seriesTagDisplay(TOOL, finding(), { text: 'Lung' }, {}).color).toEqual({});
  });

  it('applies custom value and meaning colors only', () => {
    const custom = { Background: '#000000', Border: '#123456', Value: '#FF0000', Meaning: '#C0C7F8' };
    expect(seriesTagDisplay(TOOL, finding(custom), {}, {}).color).toEqual({ Background: '#000000', Value: '#FF0000' });
  });

  it('treats a site default background as standard', () => {
    displayAttributes.setSiteDisplayAttributes({ [TOOL]: { Color: { Background: '#000000' } } });
    expect(seriesTagDisplay(TOOL, finding({ Background: '#000000', Value: '#8AD0A8' }), {}, {}).color).toEqual({});
  });

  it('treats the site defaults as the default profile', () => {
    displayAttributes.setSiteDisplayAttributes({ [TOOL]: { Color: { Value: '#00FF00' } } });
    expect(seriesTagDisplay(TOOL, finding({ Value: '#00FF00', Meaning: '#00FF00' }), {}, {}).color).toEqual({ Meaning: '#00FF00' });
  });
});
