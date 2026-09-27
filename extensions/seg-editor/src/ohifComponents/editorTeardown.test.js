// The editor viewport's deferred close: what it releases, and that one failing step does not
// take the others with it (a created segmentation left installed on its series empties the
// imaging Segmentations panel)

import OHIFSegmentationEditorViewport from './OHIFSegmentationEditorViewport';

const mockDisplaySets = {};

// Node jest environment: the close unbinds document listeners
global.document = global.document || { addEventListener() {}, removeEventListener() {} };

jest.mock('cornerstone-tools', () => ({ getModule: () => ({ state: { series: {} }, setters: {} }) }));
jest.mock('@cornerstonejs/tools', () => ({
  Enums: {}, segmentation: { config: { style: { getStyle: () => ({}) } } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools/enums', () => ({ SegmentationRepresentations: { Labelmap: 'Labelmap' } }), { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    display: { DisplaySetApi: { Instance: { displaySetService: {
      getDisplaySetByUID: uid => mockDisplaySets[uid],
      addDisplaySets: jest.fn(),
    } } } },
    DicomMetadataStore: {}, utils: {},
  },
}));
jest.mock('@ohif/core/src/utils/extractStudyIdFromURL', () => ({ extractStudyIdFromURL: () => 'study' }));
jest.mock('@ohif/ui', () => ({ eventTypes: { sidebar: { toggle: 'sidebar-toggle' } } }), { virtual: true });
jest.mock('@ohif/extension-vtk', () => {
  const { Component } = require('react');
  return {
    Enums: { VIEWPORT: 'VIEWPORT' },
    LoadingIndicator: () => null,
    VolumeFitNotice: () => null,
    OHIFVtkBaseViewport: class extends Component {},
    cornerstone3dUtils: {
      getInMemorySegmentationInfo: jest.fn(),
      releaseEditorWorkingCopy: jest.fn(),
      removeCanonicalSegmentation: jest.fn(),
    },
    vtkUtils: {},
  };
}, { virtual: true });
jest.mock('@ohif/extension-dicom-segmentation', () => ({
  eventTypes: { SegmentationPanelTabUpdatedEvent: 'seg-panel-tab-updated' },
}), { virtual: true });
jest.mock('../components/SegmentationEditorLayout.js', () => () => null);
jest.mock('../enums', () => ({ Enums: {} }));
jest.mock('../layouts/segEditorLayouts', () => ({ DEFAULT_SEG_EDITOR_LAYOUT: 'primary3D' }));

const displaySetService = require('@ohif/core').default.display.DisplaySetApi.Instance.displaySetService;
const mockUtils = require('@ohif/extension-vtk').cornerstone3dUtils;

function mountedEditor({ inMemory } = {}) {
  const runCommand = jest.fn();
  mockDisplaySets.ct = { displaySetInstanceUID: 'ct', segmentationId: 'working', stableViewport: true };
  mockUtils.getInMemorySegmentationInfo.mockReturnValue(inMemory);

  const editor = Object.create(OHIFSegmentationEditorViewport.prototype);
  editor.props = {
    viewportData: { displaySet: { displaySetInstanceUID: 'ct' } },
    commandsManager: { runCommand },
    eventTimeout: 10,
  };
  editor.labelmapStyleDefaults = { fillAlpha: 0.5 };
  editor._workingSegmentationId = 'working';
  editor._displacedSegmentationId = 'm3dseg:series';
  return { editor, runCommand };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the editor viewport closing', () => {
  it('releases the working copy, removes a created segmentation and gives the display set back', () => {
    const { editor, runCommand } = mountedEditor({ inMemory: { segmentationId: 'created', origin: 'models' } });

    editor.componentWillUnmount();
    jest.advanceTimersByTime(10);

    expect(mockUtils.releaseEditorWorkingCopy).toHaveBeenCalledWith('working');
    expect(mockUtils.removeCanonicalSegmentation).toHaveBeenCalledWith('created');
    expect(mockDisplaySets.ct).toMatchObject({ segmentationId: 'm3dseg:series', stableViewport: false });
    expect(displaySetService.addDisplaySets).toHaveBeenCalledWith([mockDisplaySets.ct]);
    expect(runCommand).toHaveBeenCalledWith('setFillAlpha', { value: 0.5, segmentationId: 'working' }, 'VIEWPORT');
    expect(editor._workingSegmentationId).toBeUndefined();
  });

  it('leaves a segmentation loaded from DICOM in place', () => {
    const { editor } = mountedEditor({ inMemory: undefined });

    editor.componentWillUnmount();
    jest.advanceTimersByTime(10);

    expect(mockUtils.releaseEditorWorkingCopy).toHaveBeenCalledWith('working');
    expect(mockUtils.removeCanonicalSegmentation).not.toHaveBeenCalled();
    expect(mockDisplaySets.ct.stableViewport).toBe(false);
  });

  it('still removes the created segmentation and releases the display set when the working copy release throws', () => {
    const { editor } = mountedEditor({ inMemory: { segmentationId: 'created', origin: 'models' } });
    mockUtils.releaseEditorWorkingCopy.mockImplementation(() => { throw new Error('display gone'); });

    editor.componentWillUnmount();
    jest.advanceTimersByTime(10);

    expect(mockUtils.removeCanonicalSegmentation).toHaveBeenCalledWith('created');
    expect(mockDisplaySets.ct).toMatchObject({ segmentationId: 'm3dseg:series', stableViewport: false });
    expect(displaySetService.addDisplaySets).toHaveBeenCalledWith([mockDisplaySets.ct]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('releasing the working copy failed'), expect.any(Error));
  });

  it('removes the created segmentation settled at load even when the working copy is already gone', () => {
    // The layout's views release their image volume before this close runs; whatever that took
    // with it, the id recorded at load still names the segmentation to remove.
    const { editor } = mountedEditor({ inMemory: undefined });
    editor._inMemorySegmentationId = 'created';

    editor.componentWillUnmount();
    jest.advanceTimersByTime(10);

    expect(mockUtils.getInMemorySegmentationInfo).not.toHaveBeenCalled();
    expect(mockUtils.removeCanonicalSegmentation).toHaveBeenCalledWith('created');
    expect(editor._inMemorySegmentationId).toBeUndefined();
  });

  it('does nothing without a claim to give back', () => {
    const { editor } = mountedEditor({ inMemory: { segmentationId: 'created' } });
    editor._workingSegmentationId = undefined;

    editor.componentWillUnmount();
    jest.advanceTimersByTime(10);

    expect(mockUtils.releaseEditorWorkingCopy).not.toHaveBeenCalled();
    expect(mockUtils.removeCanonicalSegmentation).not.toHaveBeenCalled();
  });
});
