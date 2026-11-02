import SCOORD_TYPES from '../../constants/scoordTypes';
import { CodeNameCodeSequenceValues, CodingSchemeDesignators } from '../../enums';
import { conceptCode, conceptCodeValue, conceptName, conceptNameValue } from '../../utils/codedConcept';

import getCoordsFromSCOORDOrSCOORD3D from './getCoordsFromSCOORDOrSCOORD3D';
import getLabelFromMeasuredValueSequence from './getLabelFromMeasuredValueSequence';

const CORNERSTONE_FREETEXT_CODE_VALUE = '';


const processNonGeometricallyDefinedMeasurement = (contentSequence) => {
  const NUMContentItems = contentSequence.filter((group) => group.ValueType === 'NUM');

  const CODEContentItems = contentSequence.filter((group) => group.ValueType === 'CODE');

  const UIDREFContentItem = contentSequence.find((group) => group.ValueType === 'UIDREF');

  const IMAGEContentItem = contentSequence.find((group) => group.ValueType === 'IMAGE');

  const TrackingIdentifierContentItem = contentSequence.find(
    (item) => conceptNameValue(item) === CodeNameCodeSequenceValues.TrackingIdentifier
  );

  const Finding = contentSequence.find(
    (item) => conceptNameValue(item) === CodeNameCodeSequenceValues.Finding
  );

  const FindingSites = contentSequence.filter(
    (item) =>
      conceptName(item)?.CodingSchemeDesignator === CodingSchemeDesignators.SRT &&
      conceptNameValue(item) === CodeNameCodeSequenceValues.FindingSite
  );

  const measurement = {
    loaded: false,
    labels: [],
    coords: [],
    TrackingUniqueIdentifier: UIDREFContentItem.UID,
    TrackingIdentifier: TrackingIdentifierContentItem.TextValue,
  };

  if (
    Finding &&
    conceptCode(Finding)?.CodingSchemeDesignator === CodingSchemeDesignators.cornerstoneTools4 &&
    conceptCodeValue(Finding) === CodeNameCodeSequenceValues.CornerstoneFreeText
  ) {
    measurement.labels.push({
      label: CORNERSTONE_FREETEXT_CODE_VALUE,
      value: conceptCode(Finding)?.CodeMeaning,
    });
  }

  // TODO -> Eventually hopefully support SNOMED or some proper code library, just free text for now.
  if (FindingSites.length) {
    const cornerstoneFreeTextFindingSite = FindingSites.find(
      (FindingSite) =>
        conceptCode(FindingSite)?.CodingSchemeDesignator === CodingSchemeDesignators.cornerstoneTools4 &&
        conceptCodeValue(FindingSite) === CodeNameCodeSequenceValues.CornerstoneFreeText
    );

    if (cornerstoneFreeTextFindingSite) {
      measurement.labels.push({
        label: CORNERSTONE_FREETEXT_CODE_VALUE,
        value: conceptCode(cornerstoneFreeTextFindingSite)?.CodeMeaning,
      });
    }
  }

  NUMContentItems.forEach((item) => {
    const { ConceptNameCodeSequence, ContentSequence, MeasuredValueSequence } = item;

    if (!ContentSequence) {
      console.warn(`Graphic ${ContentSequence} missing, skipping annotation.`);

      return;
    }

    const { ValueType } = ContentSequence;

    if (!ValueType === 'SCOORD' && !ValueType === 'SCOORD3D') {
      console.warn(`Graphic ${ValueType} not currently supported, skipping annotation.`);

      return;
    }

    const coords = getCoordsFromSCOORDOrSCOORD3D(ContentSequence);

    if (coords) {
      measurement.coords.push(coords);
    }

    if (MeasuredValueSequence) {
      measurement.labels.push(getLabelFromMeasuredValueSequence(ConceptNameCodeSequence, MeasuredValueSequence));
    }
  });

  if (NUMContentItems.length === 0 && IMAGEContentItem) {
    CODEContentItems.forEach((item) => {
      const { ConceptCodeSequence, ConceptNameCodeSequence } = item;

      if (!ConceptCodeSequence || !ConceptNameCodeSequence) {
        console.warn(`Graphic missing, skipping annotation.`);

        return;
      }

      const GraphicData = [0, 0];
      const GraphicType = SCOORD_TYPES.TEXT;
      const { ValueType } = item;
      const ReferencedSOPSequence = IMAGEContentItem.ReferencedSOPSequence;
      const coord = {
        ValueType,
        GraphicType,
        GraphicData,
        ReferencedSOPSequence,
      };
      measurement.coords.push(coord);
      measurement.labels.push({
        label: conceptName(item)?.CodeMeaning,
        labelCodingSchemeDesignator: conceptName(item)?.CodingSchemeDesignator,
        value: conceptCode(item)?.CodeMeaning,
        valueCodingSchemeDesignator: conceptCode(item)?.CodingSchemeDesignator,
      });
    });
  }

  return measurement;
};


export default processNonGeometricallyDefinedMeasurement;
