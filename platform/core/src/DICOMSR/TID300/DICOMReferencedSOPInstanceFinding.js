// TID300 Measurement class for parsing and encoding Series Tag data for 
// the Sonador Viewer. Tag values are encoded as Findings.

import { utilities, sr } from "dcmjs";

import { Enums as SREnums } from '../enums';

const { Code } = sr;
const { addAccessors } = utilities;
const { TID300Measurement } = utilities.TID300;


export default class DICOMReferencedSOPInstanceFinding extends TID300Measurement {

  constructor(props) {
    super(props);
  }
  
  contentItem() {
    const {
      value, text, scheme, schemeVersion, ReferencedSOPSequence,
    } = this.props;

    const contentItem = this.getMeasurement([
      {
        RelationType: SREnums.RELATIONSHIP_TYPE.CONTAINS,
        ValueType: SREnums.SCOORD_TYPES.CODE,
        ConceptNameCodeSequence: {
          CodeValue: SREnums.CodeNameCodeSequenceValues.Finding,
          CodeMeaning: 'Finding',
          CodingSchemeDesignator: SREnums.CodeNameCodeSequenceValues.DCM,
        },
        ConceptCodeSequence: {
          CodeValue: value, 
          CodeMeaning: text, 
          CodingSchemeDesignator: scheme,
          CodingSchemeVersion: schemeVersion,
        },
        ContentSequence: !ReferencedSOPSequence ? undefined : {
          RelationType: SREnums.RELATIONSHIP_TYPE.SELECTED_FROM,
          ValueType: SREnums.DCMSR_IMAGE,
          ReferencedSOPSequence,
        }
      }
    ]);

    return contentItem;
  }
};


export { DICOMReferencedSOPInstanceFinding, };