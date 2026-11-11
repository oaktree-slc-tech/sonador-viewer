import { adaptersSR } from '@cornerstonejs/adapters';

import utils from '../../utils';
import { sopClassDictionary } from '../../utils/sopClassDictionary';

import classes from '../../classes';
import measurements from '../../measurements';
import Types from '../../types';

import DicomMetadataStore from '../../services/DicomMetadataStore';
import DisplaySetService from '../../services/DisplaySetService';

import isRehydratable from './utils/isRehydratable';
import { findReferencedSOP } from './utils/findReferencedSOP';
import { codeValueOf, conceptCode, conceptCodeValue, conceptName, conceptNameValue, firstItem } from '../utils/codedConcept';
import { parseExtendedMeta } from '../utils/dcmsrExtendedMeta';
import { propertyParentOf } from '../utils/propertyParent';
import { parseDisplayAttributes } from '../utils/dcmsrDisplayAttributes';
import { displayCoordsOf } from '../utils/angleGeometry';
import { documentKind } from '../utils/srDocument';
import { DCMSR_MEASUREMENT_CONSTRUCTION_POINTS, SR_DOCUMENT_KIND } from '../enums';

const { Enums: MeasurementEnums, SREnums } = measurements;
const { CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION } = MeasurementEnums;
const { ImageSet, Cornerstone3dMetadataProvider: metadataProvider } = classes;
const { CodeScheme: Cornerstone3DCodeScheme } = adaptersSR.Cornerstone3D;
const { measurementReport: Cornerstone3dMeasurementReport } = MeasurementEnums.Cornerstone3D.sr;

const { CodeNameCodeSequenceValues, CodingSchemeDesignators } = SREnums;


type InstanceMetadata = Types.InstanceMetadata;


// Bumped when the report parsing below changes: a display set parsed by an older version of this
// module (kept alive across a hot reload) is parsed again
const PARSER_VERSION = 6;

const sopClassUids = [
  sopClassDictionary.BasicTextSR,
  sopClassDictionary.EnhancedSR,
  sopClassDictionary.ComprehensiveSR,
  sopClassDictionary.Comprehensive3DSR,
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

  const images = displaySet.images || displaySet.instances;
  const imageIds = [];

  if (!images) {
    console.warn('[DICOM-SR:Cornerstone3d:getImageIdsForDisplaySet] no images assocaited with displaySet');
    return imageIds;
  }

  images.forEach(instance => {

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
      conceptNameValue(item) === CodeNameCodeSequenceValues.ImagingMeasurements
  );

  if (!ImagingMeasurements) {
    return [];
  }

  const MeasurementGroups = _getSequenceAsArray(ImagingMeasurements.ContentSequence).filter(
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.MeasurementGroup
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

        // Extended meta (description, text, location, view, source series, drawing plane) and
        // display attributes, in the shape the read-only display and the Measurements panel read (as
        // SCOORD3D/utils/getMeasurements), from the tool's property parent: the NUM item for Length,
        // Angle, Cobb angle and circles
        const propertyParent = propertyParentOf(_trackedToolType(measurement.TrackingIdentifier));
        parseExtendedMeta(mergedContentSequence, measurement, {
          propertyParent,
          textPath: 'metadata.text',
          locationPath: 'metadata.location',
          viewsPath: 'metadata.views',
          sourceSeriesPath: 'metadata.sourceSeries',
          drawingPlanePath: 'metadata.drawingPlane',
        });
        parseDisplayAttributes(mergedContentSequence, measurement, { path: 'displayAttributes', propertyParent });

        // Drawn by the read-only display as the report holds it (a Cobb angle as its two lines)
        measurement.coords = displayCoordsOf(measurement.TrackingIdentifier, measurement.coords);

        measurements.push(measurement);
      }
    }
  );

  return measurements;
}


// The tool a tracking identifier names ("cornerstoneTools@^4.0.0:Length" -> "Length")
const _trackedToolType = (TrackingIdentifier?: string) => (typeof TrackingIdentifier === 'string'
  ? TrackingIdentifier.slice(TrackingIdentifier.lastIndexOf(':') + 1) : undefined);

// The NUM items of a group as the report holds them, each with its own children (properties,
// construction points and any content the Viewer does not model): kept with their NUM, never
// moved or flattened
const _numItemsOf = mergedContentSequence => mergedContentSequence.filter(item => item.ValueType === 'NUM');

// The graphic a NUM's value is inferred from: an SCOORD or SCOORD3D child other than its
// construction points, which are auxiliary data and never drawn
const _inferredGraphicOf = ContentSequence => _getSequenceAsArray(ContentSequence).find(child =>
  (child?.ValueType === 'SCOORD' || child?.ValueType === 'SCOORD3D')
  && conceptNameValue(child) !== DCMSR_MEASUREMENT_CONSTRUCTION_POINTS.value);


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
        conceptNameValue(item) ===
        CodeNameCodeSequenceValues.TrackingUniqueIdentifier
    );
    if (!TrackingUniqueIdentifierItem?.UID) {
      console.warn('No Tracking Unique Identifier, skipping ambiguous measurement.');
      return;
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
          conceptNameValue(item) !==
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
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  if (!graphicItem) {
    console.warn('[DICOM-SR:Cornerstone3d:_processTID1410Measurement] no SCOORD or SCOORD3D item, skipping annotation.');
    return;
  }

  const NUMContentItems = mergedContentSequence.filter(group => group.ValueType === 'NUM');

  if (!UIDREFContentItem?.UID) {
    console.warn('[DICOM-SR:Cornerstone3d:_processTID1410Measurement] no tracking unique identifier, skipping annotation.');
    return;
  }

  const measurement = {
    loaded: false,
    labels: [],
    coords: [_getCoordsFromSCOORDOrSCOORD3D(graphicItem)],
    TrackingUniqueIdentifier: UIDREFContentItem.UID,
    TrackingIdentifier: TrackingIdentifierContentItem?.TextValue,
    numItems: _numItemsOf(mergedContentSequence),
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
      conceptName(item)?.CodingSchemeDesignator === CodingSchemeDesignators.SCT &&
      conceptNameValue(item) === CodeNameCodeSequenceValues.FindingSiteSCT
  );
  if (findingSites.length) {
    measurement.labels.push({
      label: CodeNameCodeSequenceValues.FindingSiteSCT,
      value: conceptCode(findingSites[0])?.CodeMeaning,
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
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  const finding = mergedContentSequence.find(
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.Finding
  );

  const findingSites = mergedContentSequence.filter(
    item =>
      conceptName(item)?.CodingSchemeDesignator === CodingSchemeDesignators.SRT &&
      conceptNameValue(item) === CodeNameCodeSequenceValues.FindingSite
  );

  if (!UIDREFContentItem?.UID) {
    console.warn('[DICOM-SR:Cornerstone3d:_processNonGeometricallyDefinedMeasurement] no tracking unique identifier, '
      + 'skipping annotation.');
    return;
  }

  const measurement = {
    loaded: false,
    labels: [],
    coords: [],
    TrackingUniqueIdentifier: UIDREFContentItem.UID,
    TrackingIdentifier: TrackingIdentifierContentItem?.TextValue,
    numItems: _numItemsOf(mergedContentSequence),
  };

  if (
    finding &&
    CodingSchemeDesignators.CornerstoneCodeSchemes.includes(
      conceptCode(finding)?.CodingSchemeDesignator
    ) &&
    conceptCodeValue(finding) === Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
  ) {
    measurement.labels.push({
      label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
      value: conceptCode(finding)?.CodeMeaning,
    });
  }

  // TODO -> Eventually hopefully support SNOMED or some proper code library, just free text for now.
  if (findingSites.length) {
    const cornerstoneFreeTextFindingSite = findingSites.find(
      FindingSite =>
        CodingSchemeDesignators.CornerstoneCodeSchemes.includes(
          conceptCode(FindingSite)?.CodingSchemeDesignator
        ) &&
        conceptCodeValue(FindingSite) ===
          Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT
    );

    if (cornerstoneFreeTextFindingSite) {
      measurement.labels.push({
        label: Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT,
        value: conceptCode(cornerstoneFreeTextFindingSite)?.CodeMeaning,
      });
    }
  }

  NUMContentItems.forEach(item => {
    const { ConceptNameCodeSequence, ContentSequence, MeasuredValueSequence } = item;

    // The graphic the value is inferred from, when the NUM carries one
    const graphicItem = _inferredGraphicOf(ContentSequence);
    if (graphicItem) {
      measurement.coords.push(_getCoordsFromSCOORDOrSCOORD3D(graphicItem));
    }

    if (MeasuredValueSequence) {
      measurement.labels.push(
        _getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence)
      );
    }
  });

  // A group with an image and coded content but no value (a coded finding) is labelled with its
  // codes, as the classic extractor labels it; the read-only display lists them on the image.
  // Cornerstone free text is labelled above.
  const isFreeText = item => CodingSchemeDesignators.CornerstoneCodeSchemes.includes(conceptCode(item)?.CodingSchemeDesignator)
    && conceptCodeValue(item) === Cornerstone3DCodeScheme.codeValues.CORNERSTONEFREETEXT;
  const hasImage = mergedContentSequence.some(item => item.ValueType === 'IMAGE');
  if (!NUMContentItems.length && hasImage) {
    mergedContentSequence
      .filter(item => item.ValueType === 'CODE' && conceptName(item) && conceptCode(item) && !isFreeText(item))
      .forEach(item => {
        measurement.labels.push({
          label: conceptName(item).CodeMeaning,
          labelCodingSchemeDesignator: conceptName(item).CodingSchemeDesignator,
          value: conceptCode(item).CodeMeaning,
          valueCodingSchemeDesignator: conceptCode(item).CodingSchemeDesignator,
        });
      });
  }

  // A finding without coordinates (a series tag) is placed on the image its finding group
  // references. The sequence is merged across the groups sharing this tracking UID, and a finding
  // item without an image reference (a description) may come first, so every finding item is
  // considered before any other item.
  if (!measurement.coords || !measurement.coords.length) {
    const isFinding = group => Cornerstone3dMeasurementReport.codeValueMatch(group, SREnums.DCMSR_FINDING);
    const reference = findReferencedSOP(mergedContentSequence, isFinding);

    if (reference) {
      measurement.coords.push({ ReferencedSOPSequence: reference.ReferencedSOPSequence });
    } else {
      console.warn('[DICOM-SR:Cornerstone3d:_processNonGeometricallyDefinedMeasurement] no coordinates and no image '
        + 'reference in the measurement group; the measurement cannot be placed on an image', measurement);
    }
  }

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

  // The image reference sits in the item's ContentSequence, naturalized as an object or an array
  const children = _getSequenceAsArray(graphicItem.ContentSequence);
  const reference = children.map(child => child?.ReferencedSOPSequence).find(Boolean);
  coords.ReferencedSOPSequence = firstItem(reference);
  coords.ReferencedFrameOfReferenceSequence =
    graphicItem.ReferencedFrameOfReferenceUID ||
    children.map(child => child?.ReferencedFrameOfReferenceSequence).find(Boolean);
  
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
  
  const { CodeMeaning } = firstItem(ConceptNameCodeSequence) || {};
  const { NumericValue, MeasurementUnitsCodeSequence } = firstItem(MeasuredValueSequence) || {};
  const CodeValue = codeValueOf(firstItem(MeasurementUnitsCodeSequence));
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
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.ImageLibrary
  );

  if (!ImageLibrary) {
    return [];
  }

  const ImageLibraryGroup = _getSequenceAsArray(ImageLibrary.ContentSequence).find(
    item => conceptNameValue(item) === CodeNameCodeSequenceValues.ImageLibraryGroup
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
    SOPClassUID,
  } = instance;
  validateSameStudyUID(instance.StudyInstanceUID, instances);

  const is3DSR = SOPClassUID === sopClassDictionary.Comprehensive3DSR;

  // The document kind, by the root concept name: an exchange document's measurements are hydrated;
  // an application document's are displayed read-only (utils/srDocument.js)
  const kind = documentKind(instance);
  const isImagingMeasurementReport = kind === SR_DOCUMENT_KIND.EXCHANGE;
  const isApplicationDocument = kind === SR_DOCUMENT_KIND.APPLICATION;

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
    isApplicationDocument,
    sopClassUids,
    instance,
    label: SeriesDescription || `Series ${SeriesNumber} - 'SR'`,
  };

  // Attach load method to retrieve and initialize measurement data
  newDisplaySet.load = () => _load(newDisplaySet, servicesManager);

  return newDisplaySet;
}


async function _load(srDisplaySet, servicesManager) {
  // Retrieve SR data and parse to displaySet attributes. Loading once parses the report; every
  // call links the measurements that still lack an image to the display sets known so far, and
  // display sets registered later are linked as they arrive (DISPLAY_SETS_ADDED), as the OHIF v3
  // SR handler does.

  const { MeasurementService, displaySetService } = servicesManager.services;

  if (!srDisplaySet.isLoaded || srDisplaySet._parserVersion !== PARSER_VERSION) {
    const { ContentSequence } = srDisplaySet.instance;

    if (srDisplaySet.isImagingMeasurementReport || srDisplaySet.isApplicationDocument) {
      srDisplaySet.referencedImages = _getReferencedImagesList(ContentSequence)
      srDisplaySet.measurements = _getMeasurements(ContentSequence);
    } else {
      srDisplaySet.referencedImages = [];
      srDisplaySet.measurements = [];
    }

    const mappings = MeasurementService.getSourceMappings(
      CORNERSTONE_3D_TOOLS_SOURCE_NAME, CORNERSTONE_3D_TOOLS_SOURCE_VERSION);

    srDisplaySet.isHydrated = false;
    srDisplaySet.isRehydratable = isRehydratable(srDisplaySet)
    srDisplaySet.isLoaded = true;
    srDisplaySet._parserVersion = PARSER_VERSION;
  }

  // Add measurements to display, add reference image IDs
  linkMeasurementsToDisplaySets(srDisplaySet, displaySetService.activeDisplaySets, servicesManager);

  // Sources may come in after: keep linking until every measurement has its image
  if (_unloadedMeasurements(srDisplaySet).length && !srDisplaySet._displaySetsAddedSubscription) {
    srDisplaySet._displaySetsAddedSubscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED, ({ displaySetsAdded }) => {
        linkMeasurementsToDisplaySets(srDisplaySet, displaySetsAdded, servicesManager);
      });
  }
}


function _unloadedMeasurements(srDisplaySet) {
  return (srDisplaySet.measurements || []).filter(measurement => measurement.loaded === false);
}


function linkMeasurementsToDisplaySets(srDisplaySet, displaySets, servicesManager) {
  // Link the SR display set's measurements that still lack an image to the images of the given
  // display sets. Returns the number of measurements still unlinked afterwards.

  if (!srDisplaySet?.isLoaded) {
    return _unloadedMeasurements(srDisplaySet).length;
  }

  (displaySets || []).forEach(displaySet => {
    if (_unloadedMeasurements(srDisplaySet).length) {
      _checkIfCanAddMeasurementsToDisplaySet(srDisplaySet, displaySet, servicesManager);
    }
  });

  const remaining = _unloadedMeasurements(srDisplaySet).length;
  if (!remaining && srDisplaySet._displaySetsAddedSubscription) {
    srDisplaySet._displaySetsAddedSubscription.unsubscribe();
    srDisplaySet._displaySetsAddedSubscription = null;
  }
  return remaining;
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
  if (!coords || !coords.length) {
    console.warn('Unable to retrieve coordinates for the measurement');
    return false;
  }

  const ReferencedFrameNumber = firstItem(measurement.coords[0].ReferencedSOPSequence)?.ReferencedFrameNumber || 1;

  if (frameNumber && Number(frameNumber) !== Number(ReferencedFrameNumber)) {
    return false;
  }

  for (let j = 0; j < coords.length; j++) {
    const coord = coords[j];
    const { ReferencedSOPInstanceUID } = firstItem(coord.ReferencedSOPSequence) || {};
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

  // Only image series (ImageSets) carry images a measurement can be drawn on; derived display
  // sets (SR, SEG, models, documents) hold instances that resolve to no image
  if (unloadedMeasurements.length === 0 || !(newDisplaySet instanceof ImageSet) || newDisplaySet.unsupported) {
    return;
  }

  // const { sopClassUids } = newDisplaySet;
  // Create a Set for faster lookups
  // const sopClassUidSet = new Set(sopClassUids);

  // Create a Map to efficiently look up ImageIds by SOPInstanceUID and frame number. A display
  // set whose instances cannot be resolved is skipped; it must not stop the others from linking.
  const imageIdMap = new Map<string, string>();
  let imageIds;
  try {
    imageIds = _getImageIdsForDisplaySet(newDisplaySet);
  } catch (error) {
    console.warn('[DICOM-SR:Cornerstone3d:linkMeasurements] unable to resolve image ids for displaySetInstanceUID='
      + newDisplaySet.displaySetInstanceUID, error);
    return;
  }

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

    // Move to next measurement if there are no coordinates defined
    if (!measurement.coords || !measurement.coords.length) {
      continue;
    }

    // Retrieve referenced SOP sequence. Proceed to next measurement if
    // there isn't an SOP sequence referenced.
    const referencedSOPSequence = firstItem(measurement.coords[0].ReferencedSOPSequence);
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

  // A display set the service already holds for the series' newest report keeps its parsed
  // report and the links made so far
  const { displaySetService } = servicesManager.services;
  const registered = displaySet.displaySetInstanceUID
    && displaySetService?.getDisplaySetByUID(displaySet.displaySetInstanceUID);
  if (registered && typeof registered.load === 'function' && registered.isLoaded) {
    const instances = [...(series.instances || [])];
    utils.sortStudyInstances(instances);
    const newest = instances[instances.length - 1];
    if (newest && newest.SOPInstanceUID === registered.SOPInstanceUID) {
      return registered;
    }
  }

  const _ds = _getDisplaySetsFromSeries(displaySet, series.instances, servicesManager);
  return _ds;
}


export default initDisplaySetMeasurements;
export { initDisplaySetMeasurements, linkMeasurementsToDisplaySets, _getMeasurements as getMeasurements };