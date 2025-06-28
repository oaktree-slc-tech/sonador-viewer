import { adaptersSR } from '@cornerstonejs/adapters';

import utils from '../../utils';
import { sopClassDictionary } from '../../utils/sopClassDictionary';

import classes from '../../classes';
import measurements from '../../measurements';
import Types from '../../types';

import DicomMetadataStore from '../../services/DicomMetadataStore';
import DisplaySetService from '../../services/DisplaySetService';

import isRehydratable from './utils/isRehydratable';

const { Enums: MeasurementEnums, SREnums } = measurements;
const { CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION } = MeasurementEnums;
const { ImageSet, Cornerstone3dMetadataProvider: metadataProvider } = classes;
const { CodeScheme: Cornerstone3DCodeScheme } = adaptersSR.Cornerstone3D;

const { CodeNameCodeSequenceValues, CodingSchemeDesignators } = SREnums;


type InstanceMetadata = Types.InstanceMetadata;


const sopClassUids = [
  sopClassDictionary.BasicTextSR,
  sopClassDictionary.EnhancedSR,
  sopClassDictionary.ComprehensiveSR,
];


const validateSameStudyUID = (uid: string, instances): void => {
  // Ensure that all instances in the series have the same StudyInstanceUID

  instances.forEach(it => {
    if (it.StudyInstanceUID !== uid) {
      console.warn('Not all instances have the same UID', uid, it);
      throw new Error(`Instances ${it.SOPInstanceUID} does not belong to ${uid}`);
    }
  });
};


function _getImageIdsForInstance({ instance, frame }) {
  // Retrieve imageId for the provided instance and frame.
  // The method is needed since it is not possible to use instance.imageId, as objects
  // may be multi-frame which provide an invalid ImageId.

  let { StudyInstanceUID, SeriesInstanceUID } = instance;

  // Back-fill StudyInstanceUID and SeriesInstanceUID
  if (!StudyInstanceUID) {
    StudyInstanceUID = instance?._data?.metadata?.StudyInstanceUID || instance?._study?.StudyInstanceUID;
  }
  if (!SeriesInstanceUID) {
    SeriesInstanceUID = instance?._data?.metadata?.SeriesInstanceUID || instance?._series?.SeriesInstanceUID;
  }

  const SOPInstanceUID = instance.SOPInstanceUID || instance.SopInstanceUID;
  const storedInstance = DicomMetadataStore.getInstance(StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID);
  
  if (!storedInstance) {
    throw new Error('Unable to retrieve instance for StudyInstanceUID='+StudyInstanceUID+' SeriesInstanceUID='
      +SeriesInstanceUID+' SOPInstanceUID='+SOPInstanceUID);
  }
  
  // Retrieve imageId from the stored instance. Inspect url first and fallback to imageId.
  let imageId = storedInstance.url || storedInstance.imageId

  if (frame !== undefined) {
    imageId += `&frame=${frame}`;
  }

  if (!imageId) {
    throw new Error('[DICOM-SR:Cornerstone3d:getImageIdsForInstance] unable to retrieve an imageId from the stored '
      +'instance for StudyInstanceUID='+StudyInstanceUID+' SeriesInstanceUID='+SeriesInstanceUID
      +' SopInstanceUID='+SOPInstanceUID);
  }

  return imageId;
}


function _getImageIdsForDisplaySet(displaySet) {
  // Retrieve the imageIds for all images within a displayset

  const images = displaySet.instances || displaySet.images;
  const imageIds = [];

  if (!images) {
    console.warn('[DICOM-SR:Cornerstone3d:getImageIdsForDisplaySet] no images assocaited with displaySet');
    return imageIds;
  }

  displaySet.images.forEach(instance => {

    // Determine imageId
    const NumberOfFrames = instance.NumberOfFrames;
    if (NumberOfFrames > 1) {

      // Multiframe images start at frame 1
      for (let i = 1; i <= NumberOfFrames; i++) {
        const imageId = _getImageIdsForInstance({ instance, frame: i, });
        imageIds.push(imageId);
      }
    } else {
      const imageId = _getImageIdsForInstance({ instance });
      imageIds.push(imageId);
    }
  });

  return imageIds;
}


function _getMeasurements(ImagingMeasurementReportContentSequence) {
  /**
  * Retrieves the measurements from the ImagingMeasurementReportContentSequence.
  *
  * @param {Array} ImagingMeasurementReportContentSequence - The ImagingMeasurementReportContentSequence array.
  * @returns {Array} - The array of measurements.
  */

  const ImagingMeasurements = ImagingMeasurementReportContentSequence.find(
    item =>
      item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.ImagingMeasurements
  );

  if (!ImagingMeasurements) {
    return [];
  }

  const MeasurementGroups = _getSequenceAsArray(ImagingMeasurements.ContentSequence).filter(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.MeasurementGroup
  );

  const mergedContentSequencesByTrackingUniqueIdentifiers =
    _getMergedContentSequencesByTrackingUniqueIdentifiers(MeasurementGroups);
  const measurements = [];

  Object.keys(mergedContentSequencesByTrackingUniqueIdentifiers).forEach(
    trackingUniqueIdentifier => {
      const mergedContentSequence =
        mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier];

      const measurement = _processMeasurement(mergedContentSequence);
      if (measurement) {
        measurements.push(measurement);
      }
    }
  );

  return measurements;
}


function _getMergedContentSequencesByTrackingUniqueIdentifiers(MeasurementGroups) {
  /**
  * Retrieves merged content sequences by tracking unique identifiers.
  *
  * @param {Array} MeasurementGroups - The measurement groups.
  * @returns {Object} - The merged content sequences by tracking unique identifiers.
  */
  const mergedContentSequencesByTrackingUniqueIdentifiers = {};

  MeasurementGroups.forEach(MeasurementGroup => {
    const ContentSequence = _getSequenceAsArray(MeasurementGroup.ContentSequence);

    const TrackingUniqueIdentifierItem = ContentSequence.find(
      item =>
        item.ConceptNameCodeSequence.CodeValue ===
        CodeNameCodeSequenceValues.TrackingUniqueIdentifier
    );
    if (!TrackingUniqueIdentifierItem) {
      console.warn('No Tracking Unique Identifier, skipping ambiguous measurement.');
    }

    const trackingUniqueIdentifier = TrackingUniqueIdentifierItem.UID;

    if (mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] === undefined) {
      // Add the full ContentSequence
      mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier] = [
        ...ContentSequence,
      ];
    } else {
      // Add the ContentSequence minus the tracking identifier, as we have this
      // Information in the merged ContentSequence anyway.
      ContentSequence.forEach(item => {
        if (
          item.ConceptNameCodeSequence.CodeValue !==
          CodeNameCodeSequenceValues.TrackingUniqueIdentifier
        ) {
          mergedContentSequencesByTrackingUniqueIdentifiers[trackingUniqueIdentifier].push(item);
        }
      });
    }
  });

  return mergedContentSequencesByTrackingUniqueIdentifiers;
}



function _processMeasurement(mergedContentSequence) {
  /**
  * Processes the measurement based on the merged content sequence.
  * If the merged content sequence contains SCOORD or SCOORD3D value types,
  * it calls the _processTID1410Measurement function.
  * Otherwise, it calls the _processNonGeometricallyDefinedMeasurement function.
  *
  * @param {Array<Object>} mergedContentSequence - The merged content sequence to process.
  * @returns {any} - The processed measurement result.
  */
  if (
    mergedContentSequence.some(
      group => group.ValueType === 'SCOORD' || group.ValueType === 'SCOORD3D'
    )
  ) {
    return _processTID1410Measurement(mergedContentSequence);
  }

  return _processNonGeometricallyDefinedMeasurement(mergedContentSequence);
}



function _processTID1410Measurement(mergedContentSequence) {
  /**
  * Processes TID 1410 style measurements from the mergedContentSequence.
  * TID 1410 style measurements have a SCOORD or SCOORD3D at the top level,
  * and non-geometric representations where each NUM has "INFERRED FROM" SCOORD/SCOORD3D.
  *
  * @param mergedContentSequence - The merged content sequence containing the measurements.
  * @returns The measurement object containing the loaded status, labels, coordinates, tracking unique identifier, and tracking identifier.
  */

  // Need to deal with TID 1410 style measurements, which will have a SCOORD or SCOORD3D at the top level,
  // And non-geometric representations where each NUM has "INFERRED FROM" SCOORD/SCOORD3D

  const graphicItem = mergedContentSequence.find(
    group => group.ValueType === 'SCOORD' || group.ValueType === 'SCOORD3D'
  );

  const UIDREFContentItem = mergedContentSequence.find(group => group.ValueType === 'UIDREF');

  const TrackingIdentifierContentItem = mergedContentSequence.find(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  if (!graphicItem) {
    console.warn(
      `graphic ValueType ${graphicItem.ValueType} not currently supported, skipping annotation.`
    );
    return;
  }

  const NUMContentItems = mergedContentSequence.filter(group => group.ValueType === 'NUM');

  const measurement = {
    loaded: false,
    labels: [],
    coords: [_getCoordsFromSCOORDOrSCOORD3D(graphicItem)],
    TrackingUniqueIdentifier: UIDREFContentItem.UID,
    TrackingIdentifier: TrackingIdentifierContentItem.TextValue,
  };

  NUMContentItems.forEach(item => {
    const { ConceptNameCodeSequence, MeasuredValueSequence } = item;
    if (MeasuredValueSequence) {
      measurement.labels.push(
        _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence)
      );
    }
  });

  const findingSites = mergedContentSequence.filter(
    item =>
      item.ConceptNameCodeSequence.CodingSchemeDesignator === CodingSchemeDesignators.SCT &&
      item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.FindingSiteSCT
  );
  if (findingSites.length) {
    measurement.labels.push({
      label: CodeNameCodeSequenceValues.FindingSiteSCT,
      value: findingSites[0].ConceptCodeSequence.CodeMeaning,
    });
  }

  return measurement;
}


function _processNonGeometricallyDefinedMeasurement(mergedContentSequence) {
  /**
  * Processes the non-geometrically defined measurement from the merged content sequence.
  *
  * @param mergedContentSequence The merged content sequence containing the measurement data.
  * @returns The processed measurement object.
  */

  const NUMContentItems = mergedContentSequence.filter(group => group.ValueType === 'NUM');
  const UIDREFContentItem = mergedContentSequence.find(group => group.ValueType === 'UIDREF');

  const TrackingIdentifierContentItem = mergedContentSequence.find(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  const finding = mergedContentSequence.find(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.Finding
  );

  const findingSites = mergedContentSequence.filter(
    item =>
      item.ConceptNameCodeSequence.CodingSchemeDesignator === CodingSchemeDesignators.SRT &&
      item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.FindingSite
  );

  const measurement = {
    loaded: false,
    labels: [],
    coords: [],
    TrackingUniqueIdentifier: UIDREFContentItem.UID,
    TrackingIdentifier: TrackingIdentifierContentItem.TextValue,
  };

  if (
    finding &&
    CodingSchemeDesignators.CornerstoneCodeSchemes.includes(
      finding.ConceptCodeSequence.CodingSchemeDesignator
    ) &&
    finding.ConceptCodeSequence.CodeValue === Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
  ) {
    measurement.labels.push({
      label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
      value: finding.ConceptCodeSequence.CodeMeaning,
    });
  }

  // TODO -> Eventually hopefully support SNOMED or some proper code library, just free text for now.
  if (findingSites.length) {
    const cornerstoneFreeTextFindingSite = findingSites.find(
      FindingSite =>
        CodingSchemeDesignators.CornerstoneCodeSchemes.includes(
          FindingSite.ConceptCodeSequence.CodingSchemeDesignator
        ) &&
        FindingSite.ConceptCodeSequence.CodeValue ===
          Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
    );

    if (cornerstoneFreeTextFindingSite) {
      measurement.labels.push({
        label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
        value: cornerstoneFreeTextFindingSite.ConceptCodeSequence.CodeMeaning,
      });
    }
  }

    NUMContentItems.forEach(item => {
    const { ConceptNameCodeSequence, ContentSequence, MeasuredValueSequence } = item;

    const { ValueType } = ContentSequence;
    if (!ValueType === 'SCOORD') {
      console.warn(`Graphic ${ValueType} not currently supported, skipping annotation.`);
      return;
    }

    const coords = _getCoordsFromSCOORDOrSCOORD3D(ContentSequence);
    if (coords) {
      measurement.coords.push(coords);
    }

    if (MeasuredValueSequence) {
      measurement.labels.push(
        _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence)
      );
    }
  });

  return measurement;
}



const _getCoordsFromSCOORDOrSCOORD3D = graphicItem => {
  /**
  * Extracts coordinates from a graphic item of type SCOORD or SCOORD3D.
  * @param {object} graphicItem - The graphic item containing the coordinates.
  * @returns {object} - The extracted coordinates.
  */

  const { ValueType, GraphicType, GraphicData } = graphicItem;
  const coords = { ValueType, GraphicType, GraphicData };
  coords.ReferencedSOPSequence = graphicItem.ContentSequence?.ReferencedSOPSequence;
  coords.ReferencedFrameOfReferenceSequence =
    graphicItem.ReferencedFrameOfReferenceUID ||
    graphicItem.ContentSequence?.ReferencedFrameOfReferenceSequence;
  
  return coords;
};


function _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence) {
  /**
  * Retrieves the label and value from the provided ConceptNameCodeSequence and MeasuredValueSequence.
  * @param {Object} ConceptNameCodeSequence - The ConceptNameCodeSequence object.
  * @param {Object} MeasuredValueSequence - The MeasuredValueSequence object.
  * @returns {Object} - An object containing the label and value.
  *                    The label represents the CodeMeaning from the ConceptNameCodeSequence.
  *                    The value represents the formatted NumericValue and CodeValue from the MeasuredValueSequence.
  *                    Example: { label: 'Long Axis', value: '31.00 mm' }
  */
  
  const { CodeMeaning } = ConceptNameCodeSequence;
  const { NumericValue, MeasurementUnitsCodeSequence } = MeasuredValueSequence;
  const { CodeValue } = MeasurementUnitsCodeSequence;
  const formatedNumericValue = NumericValue ? Number(NumericValue).toFixed(2) : '';
  return {
    label: CodeMeaning,
    value: `${formatedNumericValue} ${CodeValue}`,
  }; // E.g. Long Axis: 31.0 mm
}


function _getReferencedImagesList(ImagingMeasurementReportContentSequence) {
  /**
  * Retrieves a list of referenced images from the Imaging Measurement Report Content Sequence.
  *
  * @param {Array} ImagingMeasurementReportContentSequence - The Imaging Measurement Report Content Sequence.
  * @returns {Array} - The list of referenced images.
  */

  const ImageLibrary = ImagingMeasurementReportContentSequence.find(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.ImageLibrary
  );

  if (!ImageLibrary) {
    return [];
  }

  const ImageLibraryGroup = _getSequenceAsArray(ImageLibrary.ContentSequence).find(
    item => item.ConceptNameCodeSequence.CodeValue === CodeNameCodeSequenceValues.ImageLibraryGroup
  );
  if (!ImageLibraryGroup) {
    return [];
  }

  const referencedImages = [];

  _getSequenceAsArray(ImageLibraryGroup.ContentSequence).forEach(item => {
    const { ReferencedSOPSequence } = item;
    if (!ReferencedSOPSequence) {
      return;
    }
    for (const ref of _getSequenceAsArray(ReferencedSOPSequence)) {
      if (ref.ReferencedSOPClassUID) {
        const { ReferencedSOPClassUID, ReferencedSOPInstanceUID } = ref;

        referencedImages.push({
          ReferencedSOPClassUID,
          ReferencedSOPInstanceUID,
        });
      }
    }
  });

  return referencedImages;
}


function _getSequenceAsArray(sequence) {
  /**
  * Converts a DICOM sequence to an array.
  * If the sequence is null or undefined, an empty array is returned.
  * If the sequence is already an array, it is returned as is.
  * Otherwise, the sequence is wrapped in an array and returned.
  *
  * @param {any} sequence - The DICOM sequence to convert.
  * @returns {any[]} - The converted array.
  */
  if (!sequence) {
    return [];
  }
  return Array.isArray(sequence) ? sequence : [sequence];
}



function _getDisplaySetsFromSeries(displaySet, instances, servicesManager) {
  /**
  * Update the provided displaySet to include references for measurement data via
  * the MeasurementService. Supports TID 1500/300 sections.
  *
  * @param displaySet: displaySet created at the time
  * @param instances is a set of instances all from the same series
  * @param servicesManager is the services that can be used for creating
  *
  * @returns The list of display sets created for the given instances object
  */

  // If the series has no instances, stop here
  if (!instances || !instances.length) {
    throw new Error('No instances were provided');
  }

  utils.sortStudyInstances(instances);
  
  // The last instance is the newest one, so is the one most interesting.
  // Eventually, the SR viewer should have the ability to choose which SR
  // gets loaded, and to navigate among them.
  const instance = instances[instances.length - 1];

  const {
    StudyInstanceUID,
    SeriesInstanceUID,
    SOPInstanceUID,
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SeriesTime,
    ConceptNameCodeSequence,
    SOPClassUID,
  } = instance;
  validateSameStudyUID(instance.StudyInstanceUID, instances);

  const is3DSR = SOPClassUID === sopClassDictionary.Comprehensive3DSR;

  const isImagingMeasurementReport =
    ConceptNameCodeSequence?.CodeValue === CodeNameCodeSequenceValues.ImagingMeasurementReport;

  const newDisplaySet = {
    ...displaySet,
    Modality: 'SR',
    SeriesDescription,
    SeriesNumber,
    SeriesDate,
    SeriesTime,
    SOPInstanceUID,
    SeriesInstanceUID,
    StudyInstanceUID,
    SOPClassUID,
    instances,
    referencedImages: null,
    measurements: null,
    isImagingMeasurementReport,
    sopClassUids,
    instance,
    label: SeriesDescription || `Series ${SeriesNumber} - 'SR'`,
  };

  // Attach load method to retrieve and initialize measurement data
  newDisplaySet.load = () => _load(newDisplaySet, servicesManager);

  return newDisplaySet;
}


async function _load(srDisplaySet, servicesManager) {
  // Retrieve SR data and parse to displaySet attributes

  const { MeasurementService, displaySetService } = servicesManager.services;
  const { ContentSequence } = srDisplaySet.instance;

  if (srDisplaySet.isImagingMeasurementReport) {
    srDisplaySet.referencedImages = _getReferencedImagesList(ContentSequence)
    srDisplaySet.measurements = _getMeasurements(ContentSequence);
  } else {
    srDisplaySet.referendImages = [];
    srDisplaySet.measurements = [];
  }

  const mappings = MeasurementService.getSourceMappings(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION);

  srDisplaySet.isHydrated = false;
  srDisplaySet.isRehydratable = isRehydratable(srDisplaySet)
  srDisplaySet.isLoaded = true;

  // Add measurements to display, add reference image IDs
  displaySetService.activeDisplaySets.forEach(activeDisplaySet => {
    _checkIfCanAddMeasurementsToDisplaySet(srDisplaySet, activeDisplaySet, servicesManager);
  });
}


function _measurementReferencesSOPInstanceUID(measurement, SOPInstanceUID, frameNumber) {
  /**
  * Checks if a measurement references a specific SOP Instance UID.
  * 
  * @param measurement - The measurement object.
  * @param SOPInstanceUID - The SOP Instance UID to check against.
  * @param frameNumber - The frame number to check against (optional).
  * @returns True if the measurement references the specified SOP Instance UID, false otherwise.
  */
  const { coords } = measurement;

  /**
   * NOTE: The ReferencedFrameNumber can be multiple values according to the DICOM
   * Standard. But for now, we will support only one ReferenceFrameNumber.
   */
  const ReferencedFrameNumber =
    (measurement.coords[0].ReferencedSOPSequence &&
      measurement.coords[0].ReferencedSOPSequence?.ReferencedFrameNumber) ||
    1;

  if (frameNumber && Number(frameNumber) !== Number(ReferencedFrameNumber)) {
    return false;
  }

  for (let j = 0; j < coords.length; j++) {
    const coord = coords[j];
    const { ReferencedSOPInstanceUID } = coord.ReferencedSOPSequence;
    if (ReferencedSOPInstanceUID === SOPInstanceUID) {
      return true;
    }
  }

  return false;
}


function _checkIfCanAddMeasurementsToDisplaySet(srDisplaySet, newDisplaySet, servicesManager) {
  /**
  * Checks if measurements can be added to a display set.
  *
  * @param srDisplaySet - The source display set containing measurements.
  * @param newDisplaySet - The new display set to check if measurements can be added.
  * @param servicesManager - The services manager.
  */

  const { customizationService } = servicesManager.services;

  const unloadedMeasurements = srDisplaySet.measurements.filter(measurement => measurement.loaded === false);

  if (unloadedMeasurements.length === 0 || !(newDisplaySet instanceof ImageSet) || newDisplaySet.unsupported) {
    return;
  }

  // const { sopClassUids } = newDisplaySet;
  // Create a Set for faster lookups
  // const sopClassUidSet = new Set(sopClassUids);

  // Create a Map to efficiently look up ImageIds by SOPInstanceUID and frame number
  const imageIdMap = new Map<string, string>();
  const imageIds = _getImageIdsForDisplaySet(newDisplaySet);

  for (const imageId of imageIds) {
    const { SOPInstanceUID, frameNumber } = metadataProvider.getUIDsFromImageID(imageId);
    const key = `${SOPInstanceUID}:${frameNumber || 1}`;
    imageIdMap.set(key, imageId);
  }

  if (!unloadedMeasurements?.length) {
    return;
  }

  const is3DSR = srDisplaySet.SOPClassUID === sopClassDictionary.Comprehensive3DSR;

  for (let j = unloadedMeasurements.length - 1; j >= 0; j--) {
    let measurement = unloadedMeasurements[j];

    const onBeforeSRAddMeasurement = customizationService.getCustomization(
      'onBeforeSRAddMeasurement'
    );

    if (typeof onBeforeSRAddMeasurement === 'function') {
      measurement = onBeforeSRAddMeasurement({
        measurement,
        StudyInstanceUID: srDisplaySet.StudyInstanceUID,
        SeriesInstanceUID: srDisplaySet.SeriesInstanceUID,
      });
    }

    const referencedSOPSequence = measurement.coords[0].ReferencedSOPSequence;
    if (!referencedSOPSequence) {
      continue;
    }

    const { ReferencedSOPInstanceUID } = referencedSOPSequence;
    const frame = referencedSOPSequence.ReferencedFrameNumber || 1;
    const key = `${ReferencedSOPInstanceUID}:${frame}`;
    const imageId = imageIdMap.get(key);

    if (imageId && _measurementReferencesSOPInstanceUID(measurement, ReferencedSOPInstanceUID, frame)) {      

      // Update measurement properties
      measurement.loaded = true;
      measurement.imageId = imageId;
      measurement.displaySetInstanceUID = newDisplaySet.displaySetInstanceUID;
      measurement.ReferencedSOPInstanceUID = ReferencedSOPInstanceUID;
      measurement.frameNumber = frame;

      unloadedMeasurements.splice(j, 1);
    }
  }
}


const initDisplaySetMeasurements = (displaySet, servicesManager) => {
  // Initialize SR measurement display properties from the provided displaySet.

  // @returns displaySet if properties were initialized or null;

  // Retrieve series and study instance UID from the displaySet, retrieve meta from DicomMetadataStore
  const { StudyInstanceUID, SeriesInstanceUID } = displaySet;
  const series = DicomMetadataStore.getSeries(StudyInstanceUID, SeriesInstanceUID);
  if (!series) {
    console.warn('[DICOM-SR:Cornerstone3d:initDisplaySetMeasurements] unable to retrieve series from metadata. '
      + 'StudyInstanceUID='+StudyInstanceUID+' SeriesInstanceUID='+SeriesInstanceUID+'.');
    return null;
  }

  const _ds = _getDisplaySetsFromSeries(displaySet, series.instances, servicesManager);
  return _ds;
}


export default initDisplaySetMeasurements;