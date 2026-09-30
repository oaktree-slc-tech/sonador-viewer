import { setMultiPanelLayout } from '@ohif/ui';

import { VIEWPORT_PLUGIN } from '../enums';


export default function setSegmentationEditorLayout(displaySet, viewportPropsArray, numRows = 1, numColumns = 1) {
  // Initialize viewport options for segmentation editor

  return setMultiPanelLayout(displaySet, viewportPropsArray, numRows, numColumns, VIEWPORT_PLUGIN);
}
