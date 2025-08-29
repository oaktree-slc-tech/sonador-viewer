// Provides a version of the MeasurementReport from the Cornerstone Adapters package for generating and reading
// tool data from DICOM-SR documents. This class provides a hook for triggering callbacks when an SR content
// item is encoded from measurement data. The hook allows for Sonador Viewer components to modify or 
// extend the content sequence with additional attributes.

import _ from 'lodash';

import { adaptersSR as c3dAdaptersSR } from '@cornerstonejs/adapters';
import { normalizers, data as dcmjsData, utilities, derivations } from "dcmjs";

import TID1500MeasurementReport from '../utils/TID1500';

const { TID1500, addAccessors } = utilities;
const { StructuredReport } = derivations;
const { Normalizer } = normalizers;

const { TID1501MeasurementGroup } = TID1500;
const { DicomMetaDictionary: dcmjsDicomMetaDictionary } = dcmjsData;

const { MeasurementReport: csMeasurementReport } = c3dAdaptersSR.Cornerstone;


function getTID300ContentItem(tool, ReferencedSOPSequence, adapterClass) {
  // Retrieve a TID300 Content item from the provided adapter class

  const args = adapterClass.getTID300RepresentationArguments(tool);
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


function getMeasurementGroup(toolType, toolData, ReferencedSOPSequence) {
  // Retreive measurement data from the tool type  

  const toolTypeData = toolData[toolType];
  const toolClass = SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE[toolType];
  if ( !toolTypeData || !toolTypeData.data || !toolTypeData.data.length || !toolClass ) {
      return;
  }  

  // Loop through the array of tool instances for this tool
  const Measurements = toolTypeData.data.map(tool => {      

      // Retrieve TID300 measurement and annotate properties with the toolType
      const tid300 = getTID300ContentItem(tool, ReferencedSOPSequence, toolClass);
      _.defaults(tid300.props, { cornerstoneToolType: toolType });
      
      return tid300;
  });
  
  return new TID1501MeasurementGroup(Measurements);
}


export default class SonadorCornerstoneMeasurementReport extends csMeasurementReport {
  // Sonador wrapper around Cornerstone Measurement Report. Provides patched methods for adding extended
  // attributes to the measurement report instances.

  static generateReport(toolState, metadataProvider, options) {
    // ToolState for array of imageIDs to a Report
    // Assume Cornerstone metadata provider has access to Study / Series / Sop Instance UID

    let allMeasurementGroups = [];
    const firstImageId = Object.keys(toolState)[0];
    if (!firstImageId) {
      throw new Error("No measurements provided.");
    }

    /* Patient ID
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Patient ID
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study Date
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study Time
    Warning - Missing attribute or value that would be needed to build DICOMDIR - Study ID
     */
    const generalSeriesModule = metadataProvider.get("generalSeriesModule", firstImageId);

    //const sopCommonModule = metadataProvider.get('sopCommonModule', firstImageId);

    // NOTE: We are getting the Series and Study UIDs from the first imageId of the toolState
    // which means that if the toolState is for multiple series, the report will have the incorrect
    // SeriesInstanceUIDs
    const { studyInstanceUID, seriesInstanceUID } = generalSeriesModule;

    // Loop through each image in the toolData
    Object.keys(toolState).forEach(imageId => {
      const sopCommonModule = metadataProvider.get("sopCommonModule", imageId);
      const frameNumber = metadataProvider.get("frameNumber", imageId);
      const toolData = toolState[imageId];
      const toolTypes = Object.keys(toolData);

      const ReferencedSOPSequence = {
        ReferencedSOPClassUID: sopCommonModule.sopClassUID,
        ReferencedSOPInstanceUID: sopCommonModule.sopInstanceUID
      };

      if (Normalizer.isMultiframeSOPClassUID(sopCommonModule.sopClassUID)) {
        ReferencedSOPSequence.ReferencedFrameNumber = frameNumber;
      }

      // Loop through each tool type for the image
      const measurementGroups = [];

      toolTypes.forEach(toolType => {
          const group = getMeasurementGroup(toolType, toolData, ReferencedSOPSequence,);
          if (group) {
            measurementGroups.push(group);
          }
      });

      allMeasurementGroups = allMeasurementGroups.concat(measurementGroups);
    });

    const measurementReport = new TID1500MeasurementReport(
      { TID1501MeasurementGroups: allMeasurementGroups }, _.omit(options, 'onContentItemCreate'));

    // TODO: what is the correct metaheader
    // http://dicom.nema.org/medical/Dicom/current/output/chtml/part10/chapter_7.html
    // TODO: move meta creation to happen in derivations.js
    const fileMetaInformationVersionArray = new Uint8Array(2);
    fileMetaInformationVersionArray[1] = 1;

    const derivationSourceDataset = {
      StudyInstanceUID: studyInstanceUID,
      SeriesInstanceUID: seriesInstanceUID
    };

  const _meta = {
      FileMetaInformationVersion: {
        Value: [fileMetaInformationVersionArray.buffer],
        vr: "OB"
      },
      //MediaStorageSOPClassUID
      //MediaStorageSOPInstanceUID: sopCommonModule.sopInstanceUID,
      TransferSyntaxUID: {
        Value: ["1.2.840.10008.1.2.1"],
        vr: "UI"
      },
      ImplementationClassUID: {
        Value: [dcmjsDicomMetaDictionary.uid()], // TODO: could be git hash or other valid id
        vr: "UI"
      },
      ImplementationVersionName: {
        Value: ["dcmjs"],
        vr: "SH"
      }
    };

    const _vrMap = { PixelData: "OW" };

    derivationSourceDataset._meta = _meta;
    derivationSourceDataset._vrMap = _vrMap;

    // Create structured report instance and content item
    const report = new StructuredReport([derivationSourceDataset]);
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
            options.onContentItemCreate(toolType, { uid, _id }, tid300Measurement, srItem);
          }
        });
      }
    }));

    // Merge the derived dataset with the content from the Measurement Report
    report.dataset = Object.assign(report.dataset, contentItem);
    report.dataset._meta = _meta;

    return report;
  }
};


// Add reference to the Cornerstone adapter registrations
SonadorCornerstoneMeasurementReport.MEASUREMENT_BY_TOOLTYPE = csMeasurementReport.MEASUREMENT_BY_TOOLTYPE;
SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE = csMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_UTILITY_TYPE;
SonadorCornerstoneMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE = csMeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE;


const MeasurementReport = SonadorCornerstoneMeasurementReport;
export { MeasurementReport };