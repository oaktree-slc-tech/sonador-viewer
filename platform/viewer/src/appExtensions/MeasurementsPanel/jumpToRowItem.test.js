// Jumping to a measurement in the classic stack viewport: the viewport is given the display set
// holding the measurement's image, with that image's SOP Instance UID, wherever the measurement
// keeps it (the row, its data or its metadata).

const mockDisplaySet = {
  displaySetInstanceUID: 'ds-1',
  images: [{ getSOPInstanceUID: () => '2.25.11' }, { getSOPInstanceUID: () => '2.25.12' }],
};
jest.mock('@ohif/core', () => ({
  log: { warn: () => {} },
  measurements: {
    MeasurementApi: {
      _getToolType: measurement => measurement.toolType,
      _unpackMeasurementData: measurement => ({
        measurementMeta: measurement.metadata || {},
        measurementData: measurement.data || {},
        uid: measurement.uid,
        _id: measurement._id,
      }),
      getToolConfiguration: () => ({ tool: {} }),
      Instance: { _serviceManagedTool: () => ({ toolServiceManaged: false }) },
    },
  },
  utils: {
    studyMetadataManager: { get: () => ({ findDisplaySet: test => ([mockDisplaySet].find(test)) }) },
  },
}), { virtual: true });

import jumpToRowItem from './jumpToRowItem';

const viewports = { layout: { viewports: [{}] }, activeViewportIndex: 0 };
const jump = (entry) => jumpToRowItem({ toolType: 'Length', measurementNumber: 1 }, viewports, {
  timepoints: [{ timepointId: 't1' }],
  measurements: { Length: [{ timepointId: 't1', measurementNumber: 1, ...entry }] },
});

it('gives the viewport the image of a measurement that keeps its SOP Instance UID only in its metadata', () => {
  const { viewportSpecificData } = jump({ metadata: { StudyInstanceUID: '2.25.1', SOPInstanceUID: '2.25.12' } });
  expect(viewportSpecificData).toHaveLength(1);
  expect(viewportSpecificData[0].displaySet.SOPInstanceUID).toBe('2.25.12');
});

it('prefers the row\'s own SOP Instance UID', () => {
  const { viewportSpecificData } = jump({ SOPInstanceUID: '2.25.11', StudyInstanceUID: '2.25.1', metadata: { SOPInstanceUID: '2.25.12' } });
  expect(viewportSpecificData[0].displaySet.SOPInstanceUID).toBe('2.25.11');
});

it("jumps to the row's own measurement when another shares its measurement number", () => {
  const { viewportSpecificData } = jumpToRowItem({ toolType: 'Length', measurementNumber: 1, measurementId: 'len-2' }, viewports, {
    timepoints: [{ timepointId: 't1' }],
    measurements: { Length: [
      { _id: 'len-1', timepointId: 't1', measurementNumber: 1, SOPInstanceUID: '2.25.11', StudyInstanceUID: '2.25.1' },
      { _id: 'len-2', timepointId: 't1', measurementNumber: 1, SOPInstanceUID: '2.25.12', StudyInstanceUID: '2.25.1' },
    ] },
  });
  expect(viewportSpecificData[0].displaySet.SOPInstanceUID).toBe('2.25.12');
});
