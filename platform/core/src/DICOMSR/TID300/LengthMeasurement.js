// TID 300 representation of the Length tool: the dcmjs Length measurement the Cornerstone adapters
// write (NUM `(410668003, SCT, "Length")` in mm, INFERRED FROM a two-point POLYLINE as SCOORD
// SELECTED FROM the image, or SCOORD3D with its Frame of Reference), with the tracking UID of a
// measurement read from an SR kept on re-save.

import { adaptersSR } from '@cornerstonejs/adapters';

import { keepTrackingUID } from './trackingGroups';

const { TID300Representation: TID300Length } = adaptersSR.Cornerstone.Length;


export default class LengthMeasurement extends TID300Length {

  getTrackingGroups() {
    return keepTrackingUID(super.getTrackingGroups(), this.props.trackingUniqueIdentifier);
  }
}


export { LengthMeasurement };
