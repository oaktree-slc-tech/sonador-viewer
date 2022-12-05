import { setMultiPanelLayout } from '@ohif/ui';

export default function setCTVolumeLayout(
  displaySet,
  viewportPropsArray,
  numRows = 1,
  numColumns = 1
) {
  // Initialize viewport options for CT volume visualization

  return setMultiPanelLayout(
    displaySet,
    viewportPropsArray,
    numRows,
    numColumns,
    'viewer3dct',
    'ct'
  );
}
