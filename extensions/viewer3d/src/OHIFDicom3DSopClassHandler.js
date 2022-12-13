import { MODULE_TYPES, utils } from '@ohif/core';

const SOP_CLASS_UIDS = {
  ENCAPSULATED_OBJ: '1.2.840.10008.5.1.4.1.1.104.4',
  ENCAPSULATED_STL_CT: '1.2.840.10008.5.1.4.1.1.2.1',
  ENCAPSULATED_STL_MRI: '1.2.840.10008.5.1.4.1.1.4.1',
};

const OHIFDicom3DSopClassHandler = {
  // OHIF SOP class handler for recognizing 3D models: GLB (OBJ), STL (CT/MRI derived).

  id: 'OHIFDicom3DSopClassHandler',
  type: MODULE_TYPES.SOP_CLASS_HANDLER,
  sopClassUIDs: [
    SOP_CLASS_UIDS.ENCAPSULATED_OBJ,
    SOP_CLASS_UIDS.ENCAPSULATED_STL_CT,
    SOP_CLASS_UIDS.ENCAPSULATED_STL_MRI,
  ],
  getDisplaySetFromSeries(series, study, dicomWebClient, authorizationHeaders) {
    // Retrieve display parameters from the series metadata. Translates content date/time to series date/time.
    const instance = series.getFirstInstance();

    const metadata = instance.getData().metadata;
    const { ContentDate, ContentTime, SeriesDescription, SeriesNumber } =
      metadata;

    return {
      plugin: 'viewerm3d',
      Modality: 'M3D',
      displaySetInstanceUID: utils.guid(),
      wadoRoot: study.getData().wadoRoot,
      wadoUri: instance.getData().wadouri,
      SOPInstanceUID: instance.getSOPInstanceUID(),
      SeriesInstanceUID: series.getSeriesInstanceUID(),
      StudyInstanceUID: study.getStudyInstanceUID(),
      SeriesDescription,
      SeriesDate: ContentDate,
      SeriesTime: ContentTime,
      SeriesNumber,
      metadata,
      authorizationHeaders: authorizationHeaders,
    };
  },
};

export default OHIFDicom3DSopClassHandler;
export { SOP_CLASS_UIDS };
