// TID 300 representation of the arrow annotation (utils/arrowGeometry.js): the Series Tag's Finding,
// whose value is the arrow's code (its free text, or a coded finding read verbatim), carrying the
// arrow's geometry as its INFERRED FROM child. No NUM item, and no second Finding: the Finding is the
// content item. The tracking UID of an arrow read from an SR is kept on re-save.
//
// `props.geometry`: { valueType ('SCOORD' | 'SCOORD3D'), graphicType ('POLYLINE' | 'POINT'), points }

import _ from 'lodash';

import { DICOMReferencedSOPInstanceFinding } from './DICOMReferencedSOPInstanceFinding';


export default class ArrowAnnotation extends DICOMReferencedSOPInstanceFinding {

  getFindingGroup() {
    return [];
  }

  geometryItem() {
    const { geometry, ReferencedSOPSequence, ReferencedFrameOfReferenceUID } = this.props;
    const use3DSpatialCoordinates = geometry.valueType === 'SCOORD3D';
    const size = use3DSpatialCoordinates ? 3 : 2;
    const GraphicData = _.flatMap(geometry.points, point => Array.from(point, Number).slice(0, size));
    if (use3DSpatialCoordinates) {
      return {
        RelationshipType: 'INFERRED FROM',
        ValueType: 'SCOORD3D',
        GraphicType: geometry.graphicType,
        GraphicData,
        ReferencedFrameOfReferenceUID,
      };
    }
    return {
      RelationshipType: 'INFERRED FROM',
      ValueType: 'SCOORD',
      GraphicType: geometry.graphicType,
      GraphicData,
      ContentSequence: {
        RelationshipType: 'SELECTED FROM',
        ValueType: 'IMAGE',
        ReferencedSOPSequence: _.cloneDeep(ReferencedSOPSequence),
      },
    };
  }

  contentItem() {
    return this.getMeasurement([this.findingItem({ ...this.props.arrowFinding }, this.geometryItem())]);
  }
}


export { ArrowAnnotation };
