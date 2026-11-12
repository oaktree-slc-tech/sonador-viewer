// cornerstone-tools Cobb angle whose value follows the DICOM-SR exchange profile: the angle
// between `start -> end` and `end2 -> start2` as Cornerstone3D computes it (0 to 180, endpoint
// order kept, no acute normalisation), with the pixel spacing applied. The drawn value, the
// Measurements panel and the saved report then agree.
//
// Its label shows the values the measurement chose for the viewport (`viewportValues`, set from its
// detail card: the angle and the two arcs), else the angle alone, as the stock tool draws it.

import csTools from 'cornerstone-tools';
import OHIF from '@ohif/core';
import { viewportLabelLines } from '@ohif/core/src/measurements/tools/measurementDetail';

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
    // The label text, which the stock renderer computes only while it is empty
    data.value = this.textBoxText(data, rowPixelSpacing, colPixelSpacing);
    data.invalidated = false;
  }

  textBoxText(data, rowPixelSpacing, colPixelSpacing) {
    const shown = data.viewportValues;
    if (!Array.isArray(shown) || !shown.some(key => key !== 'angle')) {
      return super.textBoxText(data, rowPixelSpacing, colPixelSpacing);
    }
    return viewportLabelLines('CobbAngle', data, { pixelSpacing: { row: rowPixelSpacing, column: colPixelSpacing } });
  }
}


export { CobbAngleTool };
