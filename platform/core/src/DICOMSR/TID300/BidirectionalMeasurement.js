// TID 300 representation of the Bidirectional (utils/bidirectionalGeometry.js): the Long Axis then
// the Short Axis NUM item, each with its own value and unit and INFERRED FROM its own two-point
// POLYLINE, a SCOORD SELECTED FROM the image or a SCOORD3D with its Frame of Reference. The tracking
// UID of a measurement read from an SR is kept on re-save.

import _ from 'lodash';
import { utilities } from 'dcmjs';

import { keepTrackingUID } from './trackingGroups';

const { TID300Measurement } = utilities.TID300;


export default class BidirectionalMeasurement extends TID300Measurement {

  getTrackingGroups() {
    return keepTrackingUID(super.getTrackingGroups(), this.props.trackingUniqueIdentifier);
  }

  geometryItem(points) {
    const { use3DSpatialCoordinates, ReferencedSOPSequence, ReferencedFrameOfReferenceUID } = this.props;
    const size = use3DSpatialCoordinates ? 3 : 2;
    const GraphicData = _.flatMap(points, point => Array.from(point, Number).slice(0, size));
    if (use3DSpatialCoordinates) {
      return {
        RelationshipType: 'INFERRED FROM',
        ValueType: 'SCOORD3D',
        GraphicType: 'POLYLINE',
        GraphicData,
        ReferencedFrameOfReferenceUID,
      };
    }
    return {
      RelationshipType: 'INFERRED FROM',
      ValueType: 'SCOORD',
      GraphicType: 'POLYLINE',
      GraphicData,
      ContentSequence: {
        RelationshipType: 'SELECTED FROM',
        ValueType: 'IMAGE',
        ReferencedSOPSequence: _.cloneDeep(ReferencedSOPSequence),
      },
    };
  }

  contentItem() {
    // `axes`: [{ concept, unit, value, points }], the long axis then the short axis
    return this.getMeasurement(this.props.axes.map(({ concept, unit, value, points }) => ({
      RelationshipType: 'CONTAINS',
      ValueType: 'NUM',
      ConceptNameCodeSequence: { ...concept },
      MeasuredValueSequence: {
        MeasurementUnitsCodeSequence: { ...unit },
        NumericValue: value,
      },
      ContentSequence: this.geometryItem(points),
    })));
  }
}


export { BidirectionalMeasurement };
