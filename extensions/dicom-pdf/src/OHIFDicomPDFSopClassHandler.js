import OHIF, { MODULE_TYPES, utils } from '@ohif/core';
const { DicomLoaderService } = OHIF.utils;

import dicomParser from 'dicom-parser';

// TODO: Should probably use dcmjs for this
const SOP_CLASS_UIDS = {
  ENCAPSULATED_PDF: '1.2.840.10008.5.1.4.1.1.104.1',
};

const PDF_DOCUMENT_MIMETYPE = 'application/pdf';


const OHIFDicomPDFSopClassHandler = {
  // OHIF SOP class handler for recognizing documents and other data packaged in the PDF format

  id: 'OHIFDicomPDFSopClassHandlerPlugin',
  type: MODULE_TYPES.SOP_CLASS_HANDLER,
  sopClassUIDs: [SOP_CLASS_UIDS.ENCAPSULATED_PDF],
  getDisplaySetFromSeries(extensionManager, series, study, dicomWebClient, authorizationHeaders) {
    
    // Retrieve display parameters from the series metadata. Translates content date/time to the series date/time.
    const instance = series.getFirstInstance();

    const dcm = instance.getData();
    const metadata = dcm.metadata;
    const { ContentDate, ContentTime, SeriesDescription, SeriesNumber, MIMETypeOfEncapsulatedDocument } = metadata;

    // Retrieve local data provider to parse PDF file
    const dataSource = extensionManager.getDataProvider('dcm-local');
    const defaultType = MIMETypeOfEncapsulatedDocument || 'application/pdf';
    const renderedUrl = dataSource.retrieve.directURL({
      instance: dcm.metadata,  
      tag: 'EncapsulatedDocument',
      singlepart: 'pdf',
      defaultType,
    });

    const displaySet = {
      plugin: 'pdf',
      Modality: 'DOC',
      displaySetInstanceUID: utils.guid(),
      wadoRoot: study.getData().wadoRoot,
      wadoUri: instance.getData().wadouri,
      SOPInstanceUID: instance.getSOPInstanceUID(),
      SeriesInstanceUID: series.getSeriesInstanceUID(),
      StudyInstanceUID: study.getStudyInstanceUID(),
      SeriesDescription,
      SeriesDate: ContentDate, // Map ContentDate/Time to SeriesTime for series list sorting.
      SeriesTime: ContentTime,
      SeriesNumber,
      metadata,
      dicomWebClient,
      authorizationHeaders,
      renderedUrl,
    };

    if (!renderedUrl) {

      // Fetch PDF via OHIF v2 DicomLoaderService
      const fetchPdf = () => {
        return DicomLoaderService.findDicomDataPromise(displaySet, [study]).then((data) => {

          // Parse data to Uint8Array and a raw DICOM array
          const _raw = new Uint8Array(data);
          const dcmData = dicomParser.parseDicom(_raw, { untilTag: '' });

          // Create a document file URL
          return utils.createEncapsulatedDocumentFileUrl(dcmData, _raw, {
            mimetype: PDF_DOCUMENT_MIMETYPE,
          });
        });
      }
      
      // Execute fetch method and assign result to displaySet
      displaySet.renderedUrl = fetchPdf();
    }

    return displaySet;
  },
};


export default OHIFDicomPDFSopClassHandler;
export { SOP_CLASS_UIDS, PDF_DOCUMENT_MIMETYPE };
