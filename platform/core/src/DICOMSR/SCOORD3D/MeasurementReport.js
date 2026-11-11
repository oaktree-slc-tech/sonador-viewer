// Provides a version of the MeasurementReport from the Cornerstone Adapters package for generating and reading
// tool data from DICOM-SR documents. This class provides a hook for triggering callbacks when an SR content
// item is encoded from measurement data. The hook allows for Sonador Viewer components to modify or 
// extend the content sequence with additional attributes.

import _ from 'lodash';

import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';
import { normalizers, data as dcmjsData, utilities, sr } from "dcmjs";

import { DISPLAY_LAYOUT, SONADOR_MANUFACTURER, SR_DOCUMENT_CLASS } from '../enums';
import TID1500MeasurementReport from '../utils/TID1500';
import { applyRootContent, equipment } from '../utils/srDocument';
import { isPatientKey, PERTINENT_OTHER_EVIDENCE } from '../utils/outOfPlane';

const { TID1500, addAccessors } = utilities;
const { Comprehensive3DSR } = sr.documents;

const asArray = value => (Array.isArray(value) ? value : (value ? [value] : []));
const { Normalizer } = normalizers;

const { TID1501MeasurementGroup } = TID1500;
const { DicomMetaDictionary: dcmjsDicomMetaDictionary } = dcmjsData;

const { MeasurementReport: csMeasurementReport } = c3dAdaptersSR.Cornerstone;


function getTID300ContentItem(tool, ReferencedSOPSequence, adapterClass, context) {
  // Retrieve a TID300 Content item from the provided adapter class. `context` ({ imageId,
  // metadataProvider }) is the image the tool was drawn on.

  const args = adapterClass.getTID300RepresentationArguments(tool, context);
  args.ReferencedSOPSequence = ReferencedSOPSequence;

  // Create TID 300 measurement, add references to measurement service UID and tool ID for
  // attribute linking during SR serquence generation
  const TID300Measurement = new adapterClass.TID300Representation(args);
  _.defaults(TID300Measurement.props, {
    measurementServiceUID: tool.uid || tool._measurementServiceId,
    cornerstoneUID: tool._id,
  });

  return TID300Measurement;
}


function getMeasurementGroup(toolType, toolData, ReferencedSOPSequence, context, onMeasurementRefused, evidenceReference) {
  // Retreive measurement data from the tool type. A tool the adapter refuses to encode is left
  // out of the report and passed to `onMeasurementRefused(toolType, tool, error)`.

  const toolTypeData = toolData[toolType];
  const toolClass = SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE[toolType];
  if ( !toolTypeData || !toolTypeData.data || !toolTypeData.data.length || !toolClass ) {
      return;
  }  

  // Loop through the array of tool instances for this tool
  const Measurements = toolTypeData.data.map(tool => {      

      // Retrieve TID300 measurement and annotate properties with the toolType
      let tid300;
      try {
        tid300 = getTID300ContentItem(tool, ReferencedSOPSequence, toolClass, context);
      } catch (error) {
        console.warn('[DICOM-SR:MeasurementReport:generateReport] measurement not written toolType='+toolType, error);
        if (_.isFunction(onMeasurementRefused)) {
          onMeasurementRefused(toolType, tool, error);
        }
        return null;
      }
      _.defaults(tid300.props, { cornerstoneToolType: toolType, evidenceReference });
      
      return tid300;
  }).filter(Boolean);
  
  return Measurements.length ? new TID1501MeasurementGroup(Measurements) : undefined;
}


function fileMeta() {
  // Part 10 file meta information of a report
  const fileMetaInformationVersionArray = new Uint8Array(2);
  fileMetaInformationVersionArray[1] = 1;
  return {
    FileMetaInformationVersion: { Value: [fileMetaInformationVersionArray.buffer], vr: "OB" },
    TransferSyntaxUID: { Value: ["1.2.840.10008.1.2.1"], vr: "UI" },
    ImplementationClassUID: { Value: [dcmjsDicomMetaDictionary.uid()], vr: "UI" },
    ImplementationVersionName: { Value: ["dcmjs"], vr: "SH" },
  };
}


export default class SonadorCornerstoneMeasurementReport extends csMeasurementReport {
  // Sonador wrapper around Cornerstone Measurement Report. Provides patched methods for adding extended
  // attributes to the measurement report instances.

  static generateReport(toolState, metadataProvider, options) {
    // Encode the tool state as a TID 1500 measurement report.
    //
    // @input options (object):
    //   - headers (object): SeriesNumber / SeriesDescription and other dataset headers
    //   - document (object): { template, personName } of the save (srDocument.js); defaults to a
    //     new document with the Sonador root template. The document is Comprehensive 3D SR.
    //   - onContentItemCreate (function): called per encoded measurement group with
    //     (toolType, { uid, _id }, tid300Measurement, srItem, { documentClass, layout })
    //   - onMeasurementRefused (function): called with (toolType, tool, error) for a tool the
    //     adapter cannot encode (an incomplete or degenerate angle); the tool is left out
    //   - patientSeries (object): by patient tool state key (utils/outOfPlane.js), the series its
    //     patient-domain measurements were drawn on: { StudyInstanceUID, SeriesInstanceUID,
    //     instances: [{ SOPClassUID, SOPInstanceUID }] }, listed in the evidence; an instance that
    //     names its own StudyInstanceUID and SeriesInstanceUID is listed under them
    // @returns { dataset, documentClass }
    options = options || {};
    const document = options.document || {};

    // Every document the Viewer writes is Comprehensive 3D SR; Enhanced SR is read only
    const documentClass = SR_DOCUMENT_CLASS.COMPREHENSIVE_3D;
    const { contentItem, derivationSourceDataset, evidence, pertinentOther } = this._buildContent(
      toolState, metadataProvider, options, documentClass);
    applyRootContent(contentItem, _.pick(document, 'template', 'personName'));

    // Patient and study attributes come from the first evidence item. The report content already
    // carries CurrentRequestedProcedureEvidenceSequence, so dcmjs's PertinentOtherEvidenceSequence
    // (written when no requested procedures are given) is dropped.
    const headers = options.headers || {};
    // dcmjs builds only its Pertinent Other Evidence Sequence from `evidence` (dropped below) and
    // requires at least one item: a report of carried measurements whose report listed no
    // requested-procedure evidence gives it the report's study alone.
    const document3D = new Comprehensive3DSR({
      evidence: evidence.length ? evidence : [{ StudyInstanceUID: derivationSourceDataset.StudyInstanceUID }],
      content: contentItem,
      seriesInstanceUID: dcmjsDicomMetaDictionary.uid(),
      seriesNumber: headers.SeriesNumber || '99',
      seriesDescription: headers.SeriesDescription || 'Research Derived series',
      sopInstanceUID: dcmjsDicomMetaDictionary.uid(),
      instanceNumber: 1,
      manufacturer: SONADOR_MANUFACTURER,
      isComplete: true,
    });
    const dataset = Object.assign({}, document3D);
    delete dataset.PertinentOtherEvidenceSequence;
    // Type 1C: present only with at least one item
    if (!asArray(dataset.CurrentRequestedProcedureEvidenceSequence).length) {
      delete dataset.CurrentRequestedProcedureEvidenceSequence;
    }

    // The references a carried measurement was read from the report's Pertinent Other Evidence
    // with stay there, unless the requested-procedure evidence already lists the instance
    const requested = new Set(asArray(dataset.CurrentRequestedProcedureEvidenceSequence).flatMap(study =>
      asArray(study.ReferencedSeriesSequence).flatMap(series => asArray(series.ReferencedSOPSequence)
        .map(item => item.ReferencedSOPInstanceUID))));
    const pertinent = _.uniqBy(pertinentOther.filter(item => !requested.has(item.SOPInstanceUID)), 'SOPInstanceUID');
    if (pertinent.length) {
      dataset.PertinentOtherEvidenceSequence = pertinent.map(item => ({
        StudyInstanceUID: item.StudyInstanceUID,
        ReferencedSeriesSequence: {
          SeriesInstanceUID: item.SeriesInstanceUID,
          ReferencedSOPSequence: { ReferencedSOPClassUID: item.SOPClassUID, ReferencedSOPInstanceUID: item.SOPInstanceUID },
        },
      }));
    }

    Object.assign(dataset, equipment());
    dataset._meta = fileMeta();
    dataset._vrMap = { PixelData: "OW" };
    return { dataset, documentClass };
  }

  static _buildContent(toolState, metadataProvider, options, documentClass) {
    // The TID 1500 content of the tool state, with the measurement group callbacks applied in the
    // layout of `documentClass`. Returns { contentItem, derivationSourceDataset, evidence,
    // pertinentOther } (the carried references written to the Pertinent Other Evidence Sequence).

    let allMeasurementGroups = [];
    const evidence = [];
    const pertinentOther = [];
    const firstImageId = Object.keys(toolState)[0];
    if (!firstImageId) {
      throw new Error("No measurements provided.");
    }

    // The report's study and series references come from the first image, or the first series of
    // patient-domain measurements; each measurement's evidence names its own series
    const patientSeries = options.patientSeries || {};
    const seriesOfKey = key => patientSeries[key] || {};
    const generalSeriesModule = isPatientKey(firstImageId)
      ? { studyInstanceUID: seriesOfKey(firstImageId).StudyInstanceUID, seriesInstanceUID: seriesOfKey(firstImageId).SeriesInstanceUID }
      : metadataProvider.get("generalSeriesModule", firstImageId);
    const { studyInstanceUID, seriesInstanceUID } = generalSeriesModule;
    const derivationSourceDataset = {
      StudyInstanceUID: studyInstanceUID,
      SeriesInstanceUID: seriesInstanceUID
    };
    const evidenced = new Set();
    const addEvidence = (item) => {
      if (!evidenced.has(item.SOPInstanceUID)) {
        evidenced.add(item.SOPInstanceUID);
        evidence.push(item);
      }
    };

    // Loop through each image in the toolData
    Object.keys(toolState).forEach(imageId => {
      const toolData = toolState[imageId];
      if (isPatientKey(imageId)) {
        // Patient-domain measurements: no image is referenced; the evidence lists their series
        const series = seriesOfKey(imageId);
        const [pertinent, requested] = _.partition(series.instances || [],
          instance => instance.evidenceContainer === PERTINENT_OTHER_EVIDENCE);
        const reference = {
          StudyInstanceUID: series.StudyInstanceUID || studyInstanceUID,
          SeriesInstanceUID: series.SeriesInstanceUID,
          instances: requested,
        };
        pertinent.forEach(instance => pertinentOther.push({
          ...instance,
          StudyInstanceUID: instance.StudyInstanceUID || reference.StudyInstanceUID,
          SeriesInstanceUID: instance.SeriesInstanceUID || reference.SeriesInstanceUID,
        }));
        reference.instances.forEach(instance => addEvidence({
          StudyInstanceUID: instance.StudyInstanceUID || reference.StudyInstanceUID,
          SeriesInstanceUID: instance.SeriesInstanceUID || reference.SeriesInstanceUID,
          SOPClassUID: instance.SOPClassUID, SOPInstanceUID: instance.SOPInstanceUID,
        }));
        const context = { metadataProvider };
        Object.keys(toolData).forEach(toolType => {
          const group = getMeasurementGroup(toolType, toolData, undefined, context, options.onMeasurementRefused, reference);
          if (group) {
            allMeasurementGroups.push(group);
          }
        });
        return;
      }

      const sopCommonModule = metadataProvider.get("sopCommonModule", imageId);
      const frameNumber = metadataProvider.get("frameNumber", imageId);
      const imageSeriesModule = metadataProvider.get("generalSeriesModule", imageId) || generalSeriesModule;
      const toolTypes = Object.keys(toolData);

      const ReferencedSOPSequence = {
        ReferencedSOPClassUID: sopCommonModule.sopClassUID,
        ReferencedSOPInstanceUID: sopCommonModule.sopInstanceUID
      };

      if (Normalizer.isMultiframeSOPClassUID(sopCommonModule.sopClassUID)) {
        ReferencedSOPSequence.ReferencedFrameNumber = frameNumber;
      }

      const imageSeriesUID = imageSeriesModule.seriesInstanceUID || seriesInstanceUID;
      addEvidence({
        ...derivationSourceDataset,
        SeriesInstanceUID: imageSeriesUID,
        SOPClassUID: sopCommonModule.sopClassUID,
        SOPInstanceUID: sopCommonModule.sopInstanceUID,
      });

      // Loop through each tool type for the image
      const context = { imageId, metadataProvider };
      const reference = { StudyInstanceUID: studyInstanceUID, SeriesInstanceUID: imageSeriesUID };
      toolTypes.forEach(toolType => {
        const group = getMeasurementGroup(toolType, toolData, ReferencedSOPSequence, context, options.onMeasurementRefused, reference);
        if (group) {
          allMeasurementGroups.push(group);
        }
      });
    });

    const measurementReport = new TID1500MeasurementReport(
      { TID1501MeasurementGroups: allMeasurementGroups }, _.omit(options, 'onContentItemCreate'));

    const layout = documentClass === SR_DOCUMENT_CLASS.ENHANCED ? DISPLAY_LAYOUT.FLAT : DISPLAY_LAYOUT.NESTED;
    const contentItem = measurementReport.contentItem(derivationSourceDataset, _.extend(_.omit(options, 'onContentItemCreate'), {
      onContentItemCreate: (tid300Item, srEncodedItems) => {

        // Ensure that the tid300Item and srEncodedItems are the same length and align positionally before processing.
        if (!tid300Item.TID300Measurements || !tid300Item.TID300Measurements.length || !srEncodedItems || !srEncodedItems.length
            || tid300Item.TID300Measurements.length != srEncodedItems.length) {
          console.warn('[DICOM-SR:MeasurementReport:generateReport] differences in TID 300 item and SR encoded structure prevent processing');
          return;
        }

        _.each(tid300Item.TID300Measurements, (tid300Measurement, idx) => {

          // Retrieve toolType and identifiers from TID 300 measurement
          const toolType = tid300Measurement.props.cornerstoneToolType;
          const uid = tid300Measurement.props.measurementServiceUID;
          const _id = tid300Measurement.props.cornerstoneUID;

          // Retrieve toolState
          if (!toolType || (!uid && !_id)) {
            console.warn('[DICOM-SR:MeasurementReport:generateReport] unable to match TID 300 measurement instance to toolState', tid300Measurement);
            return;
          }          

          // Trigger report content item callbacks
          const srItem = srEncodedItems[idx];
          if (_.isFunction(options.onContentItemCreate)) {
            options.onContentItemCreate(toolType, { uid, _id }, tid300Measurement, srItem, { documentClass, layout });
          }
        });
      }
    }));

    return { contentItem, derivationSourceDataset, evidence, pertinentOther };
  }
};


// Add reference to the Cornerstone adapter registrations
SonadorCornerstoneMeasurementReport.MEASUREMENT_BY_TOOLTYPE = csMeasurementReport.MEASUREMENT_BY_TOOLTYPE;
SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE = csMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE;
SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE = csMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE;


const MeasurementReport = SonadorCornerstoneMeasurementReport;
export { MeasurementReport };