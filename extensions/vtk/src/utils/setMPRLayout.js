import { setMultiPanelLayout } from '@ohif/ui';

export default function setMPRLayout(
  displaySet,
  viewportPropsArray,
  numRows = 1,
  numColumns = 1
) {
  // Create multi-panel layout for VTK/OHIF MPR tool

  return setMultiPanelLayout(
    displaySet,
    viewportPropsArray,
    numRows,
    numColumns,
    'vtk',
    'mpr'
  );
}
