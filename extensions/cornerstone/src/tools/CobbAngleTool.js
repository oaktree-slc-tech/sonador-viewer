// cornerstone-tools Cobb angle whose value follows the DICOM-SR exchange profile: the angle
// between `start -> end` and `end2 -> start2` as Cornerstone3D computes it (0 to 180, endpoint
// order kept, no acute normalisation), with the pixel spacing applied. The drawn value, the
// Measurements panel and the saved report then agree.

import csTools from 'cornerstone-tools';
import OHIF from '@ohif/core';

const getPixelSpacing = csTools.importInternal('util/getPixelSpacing');
const roundToDecimal = csTools.importInternal('util/roundToDecimal');


export default class CobbAngleTool extends csTools.CobbAngleTool {
  updateCachedStats(image, element, data) {
    const { rowPixelSpacing, colPixelSpacing } = getPixelSpacing(image);
    const scaled = ({ x, y }) => [x * (colPixelSpacing || 1), y * (rowPixelSpacing || 1)];
    const { start, end, start2, end2 } = data.handles;

    const angle = OHIF.DICOMSR.angleGeometry.angleBetweenLines(
      [scaled(start), scaled(end)], [scaled(start2), scaled(end2)]);
    data.rAngle = Number.isFinite(angle) ? roundToDecimal(angle, 2) : undefined;
    data.invalidated = false;
  }
}


export { CobbAngleTool };
