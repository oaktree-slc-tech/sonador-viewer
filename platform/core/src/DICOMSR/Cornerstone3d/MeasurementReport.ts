// Creates a version of the MeasurementReport class from the Cornerstone3D Adapaters package for generating
// and reading tool data from DICOM-SR documents. This class provides a hook for triggering callbakcs
// when an SR content item is parsed from an SR document. The hook allows for content sequence items
// to be parsed form the SR and added to the annotation instance.

import _ from 'lodash';

import { utilities, data as dcmData } from "dcmjs";
import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';

import { MeasurementApi } from '../../measurements/classes'
import { Enums as MeasurementEnums } from '../../measurements/enums';

import TID1500MeasurementReport from '../utils/TID1500';
import { findReferencedSOPSequence } from './utils/findReferencedSOP';
import { asArray, conceptNameMatches, firstItem } from '../utils/codedConcept';
import TOOL_NAMES from '../constants/toolNames';
import frameImageIds from './utils/frameImageIds';
import { isApplicationDocument, isUnconfirmedReport, markApplicationMeasurement } from '../utils/srDocument';

const { MeasurementReport: c3dMeasurementReport } = c3dAdaptersSR.Cornerstone3D;
const { DicomMetaDictionary } = dcmData;


export default class SonadorCornerstone3dMeasurementReport extends c3dMeasurementReport {
  // Sonador wrapper around Cornerstone 3D Measurement Report. Provides patched methods for reading
  // extended attributes to the measurement report instances.

  static generateToolState(dataset, sopInstanceUIDToImageIdMap, metadata, hooks, options) {
    /**
    * Generate Cornerstone tool state from dataset
    */
    options = options || {};
    const measurementApi = MeasurementApi.Instance;
    const MeasurementService = measurementApi.measurementService;    

    // TID 1500 reports only, under either root template identifier (`1500` / DCMR or
    // `Sonador-SR.1500` / Sonador-SR); the mapping resource is not checked
    const templateIdentifier = firstItem(dataset.ContentTemplateSequence)?.TemplateIdentifier;
    if (!MeasurementEnums.SREnums.SR_TEMPLATE_IDENTIFIERS.includes(templateIdentifier)) {
      throw new Error("This package can currently only interpret DICOM SR TID 1500 (template " + templateIdentifier + ")");
    }

    // Content items are matched on code identity (value and designator), in any value attribute and
    // with sequences naturalized as an object or an array
    const { CodeNameCodeSequenceValues: codes, DCM } = MeasurementEnums.SREnums;
    const dcmCode = value => ({ value, schemeDesignator: DCM });

    // Identify the Imaging Measurements
    const imagingMeasurementContent = asArray(dataset.ContentSequence)
      .find(item => conceptNameMatches(item, dcmCode(codes.ImagingMeasurements)));

    // Retrieve the Measurements themselves
    const measurementGroups = asArray(imagingMeasurementContent?.ContentSequence)
      .filter(item => conceptNameMatches(item, dcmCode(codes.MeasurementGroup)));

    // For each of the supported measurement types, compute the measurement data. Every adapter looks
    // its image up by `SOPInstanceUID:frame` (the library's Length as well as the Viewer's own).
    const measurementData = {};
    const imageIds = frameImageIds(sopInstanceUIDToImageIdMap, options.imageIdsForToolState);

    // The measurement groups of an application document (Sonador-SR root title) are not hydrated:
    // the read-only display shows them. Its Series Tags are the exception, hydrated read-only and
    // locked as from any document.
    const applicationDocument = isApplicationDocument(dataset);

    // A report the upload has not confirmed as stored holds no saved measurements yet
    const locked = !isUnconfirmedReport(dataset.SOPInstanceUID);

    measurementGroups.forEach(measurementGroup => {
      try {
        const measurementGroupContentSequence = asArray(measurementGroup.ContentSequence);

        const trackingIdentifierGroup = measurementGroupContentSequence.find(
          contentItem => conceptNameMatches(contentItem, dcmCode(codes.TrackingIdentifier)));

        const { TextValue: trackingIdentifierValue } = trackingIdentifierGroup;

        const trackingUniqueIdentifierGroup = measurementGroupContentSequence.find(
          contentItem => conceptNameMatches(contentItem, dcmCode(codes.TrackingUniqueIdentifier)));

        const trackingUniqueIdentifierValue = trackingUniqueIdentifierGroup?.UID;

        const toolAdapter = hooks?.getToolClass?.(measurementGroup, dataset, this.measurementAdapterByToolType) 
          || this.getAdapterForTrackingIdentifier(trackingIdentifierValue);

        if (toolAdapter && applicationDocument && toolAdapter.toolType !== TOOL_NAMES.DICOM_SR_SERIES_TAG) {
          console.info('[DICOMSR:MeasurementReport:generateToolState] application document, '
            + `${toolAdapter.toolType} group not hydrated trackingUID=${trackingUniqueIdentifierValue}`);
        } else if (toolAdapter) {
          // The per-frame image ids go to the Sonador adapters; the library ones ignore them
          const measurement = toolAdapter.getMeasurementData(
            measurementGroup, imageIds, metadata, trackingIdentifierValue,
            { imageIdsForToolState: options.imageIdsForToolState, locked });

          measurement.TrackingUniqueIdentifier = trackingUniqueIdentifierValue;
          if (applicationDocument) {
            markApplicationMeasurement(trackingUniqueIdentifierValue);
          }

          // Trigger content parse callback
          if (measurement && _.isFunction(options.onContentItemParse)) {
            options.onContentItemParse(toolAdapter.toolType, measurement, measurementGroup);
          }

          // Broadcast parsed annotation/measurement via service
          MeasurementService._broadcastEvent(MeasurementEnums.SERVICE_EVENTS.MEASUREMENTS_DATASYNC, {
            apiEvent: MeasurementEnums.EVENTS.MEASUREMENT_DCMSR_PARSE_MEAUSREMENT, annotation: measurement,
          });

          console.log(`=== ${toolAdapter.toolType} ===`);
          console.log(measurement);
          measurementData[toolAdapter.toolType] ||= [];
          measurementData[toolAdapter.toolType].push(measurement);
        }
      } catch (e) {
        console.warn("Unable to generate tool state for", measurementGroup, e);
      }
    });

    // NOTE: There is no way of knowing the cornerstone imageIds as that could be anything.
    // That is up to the consumer to derive from the SOPInstanceUIDs.
    return measurementData;
  }

  public static codeValueMatch(group, code, oldCode?) {
    // Inherited matcher reads CodeValue only; accept LongCodeValue / URNCodeValue as well
    return conceptNameMatches(group, ...[code, oldCode].filter(Boolean));
  }

  public static getQualitativeEvaluationData(MeasurementGroup, sopInstanceUIDToImageIdMap, metadata, toolType) {
    /*
      Parse reference data and content sequences from the provided MeasurementGroup.
    */
    const { ContentSequence } = MeasurementGroup;
    const contentSequenceArr = asArray(ContentSequence);

    // Find "primary finding group" (which is used to retrieve the ReferencedSOPSequence) and "secondary findings"
    // with additional qualitative data. The ReferencedSOPSequence for the evaluation data is taken from the 
    // primary finding group.
    const findingGroup = contentSequenceArr.find(group => this.codeValueMatch(group, MeasurementEnums.SREnums.DCMSR_FINDING));
    const findings = contentSequenceArr.filter(group => this.codeValueMatch(group, MeasurementEnums.SREnums.DCMSR_FINDING));

    if (!findingGroup || !findingGroup.ContentSequence) {
      throw new Error('No finding group found or finding group does not contain a valid content sequence');
    }

    // SOP Instance References (the sequence may be naturalized as an object or an array)
    const ReferencedSOPSequence = findReferencedSOPSequence(findingGroup);
    if (!ReferencedSOPSequence?.ReferencedSOPInstanceUID) {
      throw new Error('Finding group does not reference an image (no ReferencedSOPSequence)');
    }
    const { ReferencedSOPInstanceUID, ReferencedFrameNumber } = ReferencedSOPSequence;

    // "Loaded" image reference and image plane frame of reference. A reference without a
    // loaded image has no plane; the caller decides whether the measurement is usable.
    const referencedImageId = sopInstanceUIDToImageIdMap[ReferencedSOPInstanceUID];
    const imagePlaneModule = referencedImageId ? metadata.get('imagePlaneModule', referencedImageId) : undefined;

    // Annotation UIDs
    const annotationUID = DicomMetaDictionary.uid();

    return {
      findingGroup,
      findings,
      ReferencedSOPSequence,
      ReferencedSOPInstanceUID,
      ReferencedFrameNumber,
      referencedImageId,
      state: {
        sopInstanceUid: ReferencedSOPInstanceUID,
        annotation: {
          annotationUID, 
          data: { annotationUID }, 
          metadata: { 
            toolName: toolType, 
            referencedImageId,
            FrameOfReferenceUID: imagePlaneModule?.frameOfReferenceUID,
          }
        }
      }
    };
  }
}


const MeasurementReport = SonadorCornerstone3dMeasurementReport;
export { MeasurementReport };