// The image plane of an image for the classic tools' DICOM-SR values: the Cornerstone3D metadata,
// else the classic provider; undefined without a complete plane (DICOMSR angleGeometry `isPlane`).

import csTools from 'cornerstone-tools';
import { metaData as c3dMetaData } from '@cornerstonejs/core';
import OHIF from '@ohif/core';


export default function imagePlaneOf(imageId) {
  for (const provider of [c3dMetaData, csTools.external.cornerstone && csTools.external.cornerstone.metaData]) {
    try {
      const module = provider && provider.get('imagePlaneModule', imageId);
      if (OHIF.DICOMSR.angleGeometry.isPlane(module)) {
        return module;
      }
    } catch (error) {
      // try the next provider
    }
  }
  return undefined;
}

export { imagePlaneOf };
