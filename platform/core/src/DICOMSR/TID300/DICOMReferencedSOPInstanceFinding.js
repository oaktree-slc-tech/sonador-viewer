// TID300 Measurement class for parsing and encoding Series Tag data for 
// the Sonador Viewer. Tag values are encoded as Findings.

import { utilities } from "dcmjs";

import { Enums as SREnums } from '../enums';
import { codedConcept, codeValueOf, firstItem } from '../utils/codedConcept';
import { keepTrackingUID } from './trackingGroups';

const { TID300Measurement } = utilities.TID300;


export default class DICOMReferencedSOPInstanceFinding extends TID300Measurement {

  constructor(props) {
    super(props);
  }

  getTrackingGroups() {
    // A finding read from an SR keeps its tracking UID when re-saved (dcmjs mints a new one)
    return keepTrackingUID(super.getTrackingGroups(), this.props.trackingUniqueIdentifier);
  }

  findingItem(ConceptCodeSequence, ContentSequence) {
    // The Finding CODE item, CONTAINS from the measurement group, with its value and children
    return {
      RelationshipType: SREnums.RELATIONSHIP_TYPE.CONTAINS,
      ValueType: SREnums.SCOORD_TYPES.CODE,
      ConceptNameCodeSequence: codedConcept({
        value: SREnums.CodeNameCodeSequenceValues.Finding,
        meaning: 'Finding',
        schemeDesignator: SREnums.CodeNameCodeSequenceValues.DCM,
      }),
      ConceptCodeSequence,
      ContentSequence,
    };
  }

  contentItem() {
    const {
      value, text, scheme, schemeVersion, ReferencedSOPSequence,
    } = this.props;

    // The finding is CONTAINS from the measurement group; the image it was made on is the
    // evidence it is INFERRED FROM (SELECTED FROM is only valid from an SCOORD/TCOORD source).
    return this.getMeasurement([
      this.findingItem(
        codedConcept({ value, meaning: text, schemeDesignator: scheme, schemeVersion }),
        !ReferencedSOPSequence ? undefined : {
          RelationshipType: SREnums.RELATIONSHIP_TYPE.INFERRED_FROM,
          ValueType: SREnums.DCMSR_IMAGE,
          ReferencedSOPSequence,
        },
      ),
    ]);
  }
};


function readFindingCode(findingGroup, trackingUniqueIdentifier) {
  // The tag code of a finding written by contentItem() (or by earlier releases). Earlier releases
  // wrote the scheme designator as the version when the tag's version was lost: that value is
  // dropped, never re-emitted or replaced. Any other imported version is kept as it is.
  const findingCode = firstItem(findingGroup && findingGroup.ConceptCodeSequence);
  if (!findingCode) {
    return undefined;
  }

  const { CodingSchemeDesignator: scheme, CodeMeaning: text } = findingCode;
  let schemeVersion = findingCode.CodingSchemeVersion;
  if (schemeVersion && schemeVersion === scheme) {
    console.warn('[DICOM-SR:DICOMReferencedSOPInstanceFinding] ignoring CodingSchemeVersion equal to the scheme '
      + 'designator "' + scheme + '" trackingUID=' + trackingUniqueIdentifier);
    schemeVersion = undefined;
  }

  return { value: codeValueOf(findingCode), text, scheme, schemeVersion };
}


export { DICOMReferencedSOPInstanceFinding, readFindingCode, };