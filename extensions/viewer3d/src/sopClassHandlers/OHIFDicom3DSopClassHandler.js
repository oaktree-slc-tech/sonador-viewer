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

function getM3DModelType(metadata) {
  // Resolve the model type of an encapsulated 3D instance from its metadata. The Encapsulated
  // STL SOP class is authoritative; the MIME type of the encapsulated document (0042,0012) is
  // the fallback — the tag is not always populated.
  if (!metadata) {
    return undefined;
  }

  const { SOPClassUID, MIMETypeOfEncapsulatedDocument } = metadata;
  if (SOPClassUID === ENCAPSULATED_STL || MIMETypeOfEncapsulatedDocument === MIMETYPE_STL) {
    return MIMETYPE_STL;
  }
  if (MIMETypeOfEncapsulatedDocument === MIMETYPE_GLB) {
    return MIMETYPE_GLB;
  }
  return undefined;
}

function isSTLDisplaySet(displaySet) {
  // True when the displaySet is an M3D series of STL models. GLB scenes (and everything else)
  // return false — GLB interaction is out of scope for the M3D side panel, so consumers use
  // this to gate panel visibility and interactivity.
  if (!displaySet || displaySet.plugin !== 'viewerm3d') {
    return false;
  }
  return (displaySet.m3dModelType || getM3DModelType(displaySet.metadata)) === MIMETYPE_STL;
}

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

    // For series with multiple instances, numImageFrames reflects the instance count so that the
    // model loader can retrieve and render each mesh separately. All other identity and metadata
    // fields are always populated from the first instance so that external tools (Tag Browser,
    // SegmentationPanel, metadata queries) have a consistent anchor regardless of instance count.
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
      SeriesNumber: SeriesNumber || sxmeta.SeriesNumber,
      numImageFrames: icount && icount > 1 ? icount : numImageFrames,
      metadata,
      // Model type of the series (MIMETYPE_STL / MIMETYPE_GLB / undefined), resolved from the
      // first instance. Drives side-panel gating: STL series enable the M3D sidebar; GLB do not.
      m3dModelType: getM3DModelType(metadata),
      // images must be the InstanceMetadata array from the series so that StudyMetadata
      // getFirstImageId() and the Tag Browser metadata fallback path both work correctly.
      // The rendering path (OHIFDicomM3DViewport) re-fetches each instance by WADO URI
      // and does not use this array for display.
      images: series._instances,
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
  getM3DModelType,
  isSTLDisplaySet,
};
