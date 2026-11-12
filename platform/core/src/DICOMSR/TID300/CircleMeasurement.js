// TID 300 representation of the circle (utils/circleGeometry.js): the Area, Perimeter and Radius
// NUM items in that order, each INFERRED FROM its own copy of the geometry, a SCOORD CIRCLE (center,
// edge point) SELECTED FROM the image, or a SCOORD3D ELLIPSE (four axis end points) with its Frame
// of Reference. The tracking UID of a measurement read from an SR is kept on re-save.

import _ from 'lodash';
import { utilities } from 'dcmjs';

import { CIRCLE_VALUES } from '../utils/circleGeometry';
import { keepTrackingUID } from './trackingGroups';

const { TID300Measurement } = utilities.TID300;


export default class CircleMeasurement extends TID300Measurement {

  getTrackingGroups() {
    return keepTrackingUID(super.getTrackingGroups(), this.props.trackingUniqueIdentifier);
  }

  geometryItem() {
    // A fresh copy for each NUM item
    const { points, use3DSpatialCoordinates, ReferencedSOPSequence, ReferencedFrameOfReferenceUID } = this.props;
    const size = use3DSpatialCoordinates ? 3 : 2;
    const GraphicData = _.flatMap(points, point => Array.from(point, Number).slice(0, size));
    if (use3DSpatialCoordinates) {
      return {
        RelationshipType: 'INFERRED FROM',
        ValueType: 'SCOORD3D',
        GraphicType: 'ELLIPSE',
        GraphicData,
        ReferencedFrameOfReferenceUID,
      };
    }
    return {
      RelationshipType: 'INFERRED FROM',
      ValueType: 'SCOORD',
      GraphicType: 'CIRCLE',
      GraphicData,
      ContentSequence: {
        RelationshipType: 'SELECTED FROM',
        ValueType: 'IMAGE',
        ReferencedSOPSequence: _.cloneDeep(ReferencedSOPSequence),
      },
    };
  }

  contentItem() {
    const { values } = this.props;
    return this.getMeasurement(CIRCLE_VALUES.map(({ name, concept, unit }) => ({
      RelationshipType: 'CONTAINS',
      ValueType: 'NUM',
      ConceptNameCodeSequence: { ...concept },
      MeasuredValueSequence: {
        MeasurementUnitsCodeSequence: { ...unit },
        NumericValue: values[name],
      },
      ContentSequence: this.geometryItem(),
    })));
  }
}


export { CircleMeasurement };
