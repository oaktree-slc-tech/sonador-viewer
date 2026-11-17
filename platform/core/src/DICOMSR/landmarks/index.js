import readLandmarkSets, { LANDMARK_TYPES } from './readLandmarkSets';
import { holdsLandmarkSets, isLandmarkSetTrackingIdentifier } from './landmarkGroups';
import { landmarkColors, ownColorRoles, setColors } from './landmarkColors';
import { attributionOf, HELD_NOTES, placementOf, seriesOfFrame } from './landmarkPlacement';
import {
  addLandmarkSetsOf, clearLandmarkSets, EVENTS, getLandmarkSet, getLandmarkSets, subscribe,
} from './landmarkSetStore';

const landmarks = {
  LANDMARK_TYPES,
  HELD_NOTES,
  EVENTS,
  readLandmarkSets,
  holdsLandmarkSets,
  isLandmarkSetTrackingIdentifier,
  landmarkColors,
  ownColorRoles,
  setColors,
  attributionOf,
  placementOf,
  seriesOfFrame,
  addLandmarkSetsOf,
  clearLandmarkSets,
  getLandmarkSet,
  getLandmarkSets,
  subscribe,
};

export default landmarks;
