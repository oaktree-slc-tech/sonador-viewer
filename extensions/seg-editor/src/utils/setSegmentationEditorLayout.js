import { setMultiPanelLayout } from '@ohif/ui';


export default function setSegmentationEditorLayout(displaySet, viewportPropsArray, numRows = 1, numColumns = 1) {
  // Initialize viewport options for segmentation editor

  return setMultiPanelLayout(displaySet, viewportPropsArray, numRows, numColumns, 'sonador3dseg');
}
