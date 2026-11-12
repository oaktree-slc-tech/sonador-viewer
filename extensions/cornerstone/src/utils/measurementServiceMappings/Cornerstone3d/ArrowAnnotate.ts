import SUPPORTED_TOOLS from './constants/supportedTools';
import { getIsLocked } from './utils/getIsLocked';
import getSOPInstanceAttributes from './utils/getSOPInstanceAttributes';
import displaySetOf from './utils/displaySetOf';
import { getIsVisible } from './utils/getIsVisible';

const ArrowAnnotate = {
  toolName: 'ArrowAnnotate',
  toAnnotation: measurement => {},

  /**
   * Maps cornerstone annotation event data to measurement service format.
   *
   * @param {Object} cornerstone Cornerstone event data
   * @return {Measurement} Measurement instance
   */
  toMeasurement: (
    csToolsEventDetail,
    displaySetService,
    cornerstoneViewportService,
    getValueTypeFromToolType,
    customizationService
  ) => {
    const { annotation } = csToolsEventDetail;
    const { metadata, data, annotationUID } = annotation;

    const isLocked = getIsLocked(annotationUID);
    const isVisible = getIsVisible(annotationUID);
    if (!metadata || !data) {
      console.warn('Length tool: Missing metadata or data');
      return null;
    }

    const { toolName, referencedImageId, FrameOfReferenceUID } = metadata;
    const validToolType = SUPPORTED_TOOLS.includes(toolName);

    if (!validToolType) {
      throw new Error('Tool not supported');
    }

    const { SOPInstanceUID, SeriesInstanceUID, StudyInstanceUID } = getSOPInstanceAttributes(
      referencedImageId,
      displaySetService,
      annotation
    );

    const displaySet = displaySetOf(displaySetService, SOPInstanceUID, SeriesInstanceUID);

    const { points, textBox } = data.handles;

    const mappedAnnotations = getMappedAnnotations(annotation, displaySetService);

    const displayText = getDisplayText(mappedAnnotations, displaySet);
    const getReport = () => _getReport(mappedAnnotations, points, FrameOfReferenceUID);

    return {
      uid: annotationUID,
      SOPInstanceUID,
      FrameOfReferenceUID,
      points,
      textBox,
      isLocked,
      isVisible,
      // Display colours read from the report (DICOMSR/utils/dcmsrDisplayAttributes.js); the
      // service accepts only its schema keys at the top level
      metadata: data.displayAttributes ? { ...metadata, displayAttributes: data.displayAttributes } : metadata,
      referenceSeriesUID: SeriesInstanceUID,
      referenceStudyUID: StudyInstanceUID,
      referencedImageId,
      frameNumber: mappedAnnotations[0]?.frameNumber || 1,
      toolName: metadata.toolName,
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      label: data.text,
      displayText: displayText,
      data: data.cachedStats,
      type: getValueTypeFromToolType(toolName),
      getReport,
    };
  },
};


function getMappedAnnotations(annotation, displaySetService) {
  const { metadata, data } = annotation;
  const { text } = data;
  const { referencedImageId } = metadata;

  const annotations = [];

  const { SOPInstanceUID, SeriesInstanceUID, frameNumber } = getSOPInstanceAttributes(
    referencedImageId,
    displaySetService,
    annotation
  );

  const displaySet = displaySetOf(displaySetService, undefined, SeriesInstanceUID);

  const { SeriesNumber } = displaySet;

  annotations.push({
    SeriesInstanceUID,
    SOPInstanceUID,
    SeriesNumber,
    frameNumber,
    text,
  });

  return annotations;
}


function getDisplayText(mappedAnnotations, displaySet) {
  const displayText = {
    primary: [],
    secondary: [],
  };

  if (!mappedAnnotations || !mappedAnnotations.length) {
    return displayText;
  }

  const { SeriesNumber, SOPInstanceUID, frameNumber, text } = mappedAnnotations[0];

  const instance = displaySet.instances.find(image => image.SOPInstanceUID === SOPInstanceUID);

  let InstanceNumber;
  if (instance) {
    InstanceNumber = instance.InstanceNumber;
  }

  const instanceText = InstanceNumber ? ` I: ${InstanceNumber}` : '';
  const frameText = displaySet.isMultiFrame ? ` F: ${frameNumber}` : '';

  // Add the annotation text to the primary array
  if (text) {
    displayText.primary.push(text);
  }

  // Add the series information to the secondary array
  displayText.secondary.push(`S: ${SeriesNumber}${instanceText}${frameText}`);

  return displayText;
}


function _getReport(mappedAnnotations, points, FrameOfReferenceUID) {
  const columns = [];
  const values = [];

  columns.push('AnnotationType');
  values.push('Cornerstone:ArrowAnnote');

  mappedAnnotations.forEach(annotation => {
    const { text } = annotation;
    columns.push(`Text`);
    values.push(text);
  });

  if (FrameOfReferenceUID) {
    columns.push('FrameOfReferenceUID');
    values.push(FrameOfReferenceUID);
  }

  if (points) {
    columns.push('points');
    values.push(points.map(p => p.join(' ')).join(';'));
  }

  return {
    columns,
    values,
  };
}


export default ArrowAnnotate;
export { ArrowAnnotate, }