// The tools that create annotations: the measurement tools of the Measurements API configuration,
// the Cornerstone3D tools the MPR and Inspector views draw with, and the Series Tag. Navigation,
// window and level, the probe and the ROI window stay available while annotations cannot be created.

import { Enums as SREnums } from '../DICOMSR/enums';
import { measurementApiDefaultConfig } from './configuration';

const CORNERSTONE3D_ANNOTATION_TOOLS = [
  'Length', 'Angle', 'CobbAngle', 'ArrowAnnotate', 'Bidirectional', 'CircleROI', 'EllipticalROI', 'RectangleROI',
  'PlanarFreehandROI', 'Probe', 'SonadorCircleROI', 'SonadorAngle', 'SonadorCobbAngle',
];

const NON_ANNOTATION_TOOLS = ['DragProbe', 'WwwcRegion', 'Wwwc', 'Pan', 'Zoom', 'StackScroll', 'Magnify'];

const configuredToolIds = () => (measurementApiDefaultConfig.measurementTools || [])
  .flatMap(group => (group.childTools || []).map(tool => tool.id));

/** Whether a tool creates annotations */
function isAnnotationTool(toolName) {
  if (!toolName || NON_ANNOTATION_TOOLS.includes(toolName)) {
    return false;
  }
  return CORNERSTONE3D_ANNOTATION_TOOLS.includes(toolName)
    || configuredToolIds().includes(toolName)
    || toolName === SREnums.TOOL_NAMES.DICOM_SR_SERIES_TAG;
}

export { CORNERSTONE3D_ANNOTATION_TOOLS, isAnnotationTool };
