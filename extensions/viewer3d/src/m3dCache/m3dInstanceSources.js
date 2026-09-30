// The DICOM instances of a 3D model series: how each one's bytes are fetched, and the label and
// colour its metadata gives the model. Shared by the M3D viewport (which loads a series to show
// it), the series' presentation state (which names the models) and the Segmentation Editor's
// imports (which read a series' models without showing it).

import dcmjs from 'dcmjs';
import _ from 'lodash';

import OHIF, { str2ab } from '@ohif/core';

const { DicomLoaderService } = OHIF.utils;


/** The naturalized metadata of one instance of the series, or undefined */
export function getM3DInstanceMetadata(series, sopInstanceUID) {
  if (!series || !sopInstanceUID) {
    return undefined;
  }
  const instance = series.getInstanceByUID(sopInstanceUID);
  return instance && instance.getData ? instance.getData().metadata : undefined;
}

/**
 * The display colour of an instance as a '#rrggbb' string (RecommendedDisplayCIELabValue), or
 * undefined. Available from the series metadata, without fetching the encapsulated document.
 */
export function getM3DInstanceColor(series, sopInstanceUID) {
  const metadata = getM3DInstanceMetadata(series, sopInstanceUID);
  if (!metadata?.RecommendedDisplayCIELabValue) {
    return undefined;
  }
  return OHIF.utils.color.rgb2hex(
    ...dcmjs.data.Colors.dicomlab2RGB(metadata.RecommendedDisplayCIELabValue).map((x) => Math.round(x * 255))
  );
}

/**
 * The name of a model: Content Description (0070,0081), then Content Label (0070,0080), then
 * 'Model <n>'.
 */
export function getM3DInstanceLabel(metadata, index) {
  return metadata?.ContentDescription || metadata?.ContentLabel || `Model ${index}`;
}

/**
 * The instances of a model display set, each with a thunk that resolves its full DICOM byte
 * stream (or the raw encapsulated document, for a single-instance series delivered inline).
 *
 * @param {Object} displaySet - the M3D display set
 * @param {Object[]} studies - the viewer's studies (the loader service reads local uploads from them)
 * @returns {Array<{ sopInstanceUID: string, fetchRawData: () => Promise<ArrayBuffer|Uint8Array> }>}
 */
export function listM3DInstanceSources(displaySet, studies) {
  const { numImageFrames, series } = displaySet;

  // Inline binary is only valid for single-instance series. Multi-instance series must always
  // fetch each model separately via their individual WADO URIs — the metadata on the display
  // set is that of the first instance only and must not short-circuit the full fetch loop.
  if ((!numImageFrames || numImageFrames <= 1) && displaySet.metadata?.EncapsulatedDocument) {
    const { InlineBinary } = displaySet.metadata.EncapsulatedDocument;
    if (InlineBinary) {
      return [{
        sopInstanceUID: displaySet.SOPInstanceUID,
        fetchRawData: () => Promise.resolve(str2ab(atob(InlineBinary))),
      }];
    }
  }

  if (!numImageFrames && _.isUndefined(numImageFrames)) {
    return [{
      sopInstanceUID: displaySet.SOPInstanceUID,
      fetchRawData: () => DicomLoaderService.findDicomDataPromise(displaySet, studies),
    }];
  }

  if (numImageFrames && numImageFrames > 1) {
    return _.times(numImageFrames, (i) => {
      const instance = series.getInstanceByIndex(i);
      const sopInstanceUID = instance.getSOPInstanceUID();

      // A copy of the display set with the instance's own data. `images` must be cleared:
      // DicomLoaderService.getDataByImageType() reads dataset.images[0] and would always fetch the
      // first instance regardless of the wadoUri override; without it the service falls through
      // to getDataByDatasetType(), which uses the per-instance wadoUri and SOPInstanceUID.
      const displayInstance = _.extend(_.clone(displaySet), {
        wadoUri: instance.getData().wadouri,
        SOPInstanceUID: sopInstanceUID,
        images: undefined,
      });

      return {
        sopInstanceUID,
        fetchRawData: () => DicomLoaderService.findDicomDataPromise(displayInstance, studies),
      };
    });
  }

  return [];
}
