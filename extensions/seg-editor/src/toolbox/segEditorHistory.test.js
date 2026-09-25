// Undo / redo through Cornerstone3D's own history class (the one DefaultHistoryMemo is an instance
// of), with labelmap-style memos: a brush stroke and a 3D delete

import { clearSegEditorHistory, redoSegEditorEdit, undoSegEditorEdit } from './segEditorHistory';

jest.mock('@cornerstonejs/core', () => ({ utilities: { HistoryMemo: {} } }), { virtual: true });

// The pinned library's HistoryMemo, loaded from its own file (the package's exports map hides it)
jest.mock('../../../../node_modules/@cornerstonejs/core/dist/esm/eventTarget', () => ({
  __esModule: true, default: { dispatchEvent: () => true },
}));
const { HistoryMemo } = require('../../../../node_modules/@cornerstonejs/core/dist/esm/utilities/historyMemo/index.js');

// A memo that toggles one voxel between two values, as LabelmapMemo's restoreMemo does
function voxelMemo(voxels, index, before, after) {
  return {
    restoreMemo(isUndo) {
      voxels[index] = isUndo === false ? after : before;
    },
  };
}

describe('segEditorHistory', () => {
  it('undoes and redoes a brush edit and a 3D delete, most recent first', () => {
    const history = new HistoryMemo('test', 10);
    const voxels = [0, 3];
    voxels[0] = 1; history.push(voxelMemo(voxels, 0, 0, 1)); // brush paints voxel 0
    voxels[1] = 0; history.push(voxelMemo(voxels, 1, 3, 0)); // 3D delete removes voxel 1

    expect(undoSegEditorEdit(history)).toBe(true);
    expect(voxels).toEqual([1, 3]);
    expect(undoSegEditorEdit(history)).toBe(true);
    expect(voxels).toEqual([0, 3]);
    expect(undoSegEditorEdit(history)).toBe(false);

    expect(redoSegEditorEdit(history)).toBe(true);
    expect(voxels).toEqual([1, 3]);
    expect(redoSegEditorEdit(history)).toBe(true);
    expect(voxels).toEqual([1, 0]);
    expect(redoSegEditorEdit(history)).toBe(false);
  });

  it('clearing at the session boundary leaves nothing to replay', () => {
    const history = new HistoryMemo('test', 10);
    const voxels = [1];
    history.push(voxelMemo(voxels, 0, 0, 1));
    undoSegEditorEdit(history);
    history.push(voxelMemo(voxels, 0, 0, 1));

    clearSegEditorHistory(history);

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.size).toBe(10);
    expect(undoSegEditorEdit(history)).toBe(false);
    expect(voxels).toEqual([0]);
  });
});
