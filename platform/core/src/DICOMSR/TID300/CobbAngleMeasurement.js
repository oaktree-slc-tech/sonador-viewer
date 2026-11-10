// TID 300 representation of the Angle and Cobb angle tools: the dcmjs Cobb angle measurement
// (NUM `(285285000, SCT, "Cobb angle")` in degrees, INFERRED FROM a four-point POLYLINE as SCOORD
// SELECTED FROM the image, or SCOORD3D with its Frame of Reference), with the tracking UID of a
// measurement read from an SR kept on re-save.

import { utilities } from 'dcmjs';

import { keepTrackingUID } from './trackingGroups';

const { CobbAngle: TID300CobbAngle } = utilities.TID300;


export default class CobbAngleMeasurement extends TID300CobbAngle {

  getTrackingGroups() {
    return keepTrackingUID(super.getTrackingGroups(), this.props.trackingUniqueIdentifier);
  }
}


export { CobbAngleMeasurement };
