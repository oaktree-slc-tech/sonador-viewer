import { MODULE_TYPES, utils } from '@ohif/core';

const ENCAPSULATED_OBJ = '1.2.840.10008.5.1.4.1.1.104.4';
const ENCAPSULATED_STL = '1.2.840.10008.5.1.4.1.1.104.3';

const MIMETYPE_GLB = 'model/gltf-binary';
const MIMETYPE_STL = 'model/stl';

const SOP_CLASS_UIDS = {
  ENCAPSULATED_OBJ,
  ENCAPSULATED_STL,
};

const M3D_MIMETYPES = {
  MIMETYPE_GLB,
  MIMETYPE_STL,
};

const OHIFDicom3DSopClassHandler = {
  // OHIF SOP class handler for recognizing 3D models: GLB (OBJ), STL (CT/MRI derived).

  id: 'OHIFDicom3DSopClassHandler',
  type: MODULE_TYPES.SOP_CLASS_HANDLER,
  sopClassUIDs: [
    SOP_CLASS_UIDS.ENCAPSULATED_OBJ,
    SOP_CLASS_UIDS.ENCAPSULATED_STL,
  ],
  getDisplaySetFromSeries(series, study, dicomWebClient, authorizationHeaders) {
    // Retrieve display parameters from the series metadata. Translates content date/time to series date/time.
    const instance = series.getFirstInstance();

    const icount = series.getInstanceCount();
    const sxmeta = series.getData();
    const metadata = instance.getData().metadata;

    const {
      ContentDate,
      ContentTime,
      SeriesDescription,
      SeriesNumber,
      ContentDescription,
      DocumentTitle,
      numImageFrames,
    } = metadata;

    // For series with multiple instances, add the count to the numImageFrames and omit the inclusion of instance
    // metadata. The model loader will need to retrieve and parse the metadata for each instance separately
    // and pass it to the 3D viewport for rendering.
    return {
      plugin: 'viewerm3d',
      Modality: 'M3D',
      displaySetInstanceUID: utils.guid(),
      wadoRoot: study.getData().wadoRoot,
      wadoUri: icount && icount == 1 ? instance.getData().wadouri : undefined,
      SOPInstanceUID:
        icount && icount == 1 ? instance.getSOPInstanceUID() : undefined,
      SeriesInstanceUID: series.getSeriesInstanceUID(),
      StudyInstanceUID: study.getStudyInstanceUID(),
      SeriesDescription,
      SeriesDate: ContentDate,
      SeriesTime: ContentTime,
      SeriesNumber: SeriesNumber || sxmeta.SeriesNumber,
      numImageFrames: icount && icount > 1 ? icount : numImageFrames,
      metadata: icount && icount == 1 ? metadata : undefined,
      authorizationHeaders: authorizationHeaders,
      series,
    };
  },
};

export default OHIFDicom3DSopClassHandler;
export {
  SOP_CLASS_UIDS,
  ENCAPSULATED_OBJ,
  ENCAPSULATED_STL,
  M3D_MIMETYPES,
  MIMETYPE_GLB,
  MIMETYPE_STL,
};
