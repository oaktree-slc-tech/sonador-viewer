// The undo-recorded labelmap write: what a failure before and after the record does

const mockHistory = { push: jest.fn() };
const mockTrigger = { triggerSegmentationDataModified: jest.fn() };
const mockMemo = { voxelManager: { setAtIndex: jest.fn() }, commitMemo: jest.fn(() => true) };

// virtual: jest's resolver does not follow the Cornerstone3D packages' `exports` maps
jest.mock('@cornerstonejs/core', () => ({
  cache: {}, getWebWorkerManager: () => ({}), utilities: { HistoryMemo: { DefaultHistoryMemo: mockHistory } },
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => ({
  segmentation: { state: {}, triggerSegmentationEvents: mockTrigger },
  utilities: { segmentation: { LabelmapMemo: { createLabelmapMemo: () => mockMemo } } },
}), { virtual: true });
jest.mock('@cornerstonejs/polymorphic-segmentation', () => ({ init: () => {} }), { virtual: true });
jest.mock('./registerHoleFillingWorker', () => ({ registerHoleFillingWorker: () => {} }));

// Required after the mocks above are defined: their factories run when this module loads
const { editLabelmapVoxels } = require('./segmentEdits');

const volume = { voxelManager: {} };

beforeEach(() => jest.clearAllMocks());

describe('editLabelmapVoxels', () => {
  it('records the edit and tells the views', () => {
    expect(editLabelmapVoxels({ segmentationId: 'seg', volume, edit: set => set(3, 2) })).toBe(true);
    expect(mockMemo.voxelManager.setAtIndex).toHaveBeenCalledWith(3, 2);
    expect(mockHistory.push).toHaveBeenCalledWith(mockMemo);
    expect(mockTrigger.triggerSegmentationDataModified).toHaveBeenCalledWith('seg');
  });

  it('records nothing when the edit itself throws, and lets the error through', () => {
    const failure = new Error('voxel manager gone');
    expect(() => editLabelmapVoxels({ segmentationId: 'seg', volume, edit: () => { throw failure; } })).toThrow(failure);
    expect(mockMemo.commitMemo).not.toHaveBeenCalled();
    expect(mockHistory.push).not.toHaveBeenCalled();
    expect(mockTrigger.triggerSegmentationDataModified).not.toHaveBeenCalled();
  });

  it('keeps a recorded edit when a listener fails afterwards, logging instead of throwing', () => {
    mockTrigger.triggerSegmentationDataModified.mockImplementationOnce(() => { throw new Error('listener threw'); });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(editLabelmapVoxels({ segmentationId: 'seg', volume, edit: set => set(0, 1) })).toBe(true);
    expect(mockHistory.push).toHaveBeenCalledWith(mockMemo);
    expect(console.error).toHaveBeenCalled();
    console.error.mockRestore();
  });
});
