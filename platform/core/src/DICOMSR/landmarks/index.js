import readLandmarkSets, { LANDMARK_TYPES } from './readLandmarkSets';
import { holdsLandmarkSets, isLandmarkSetTrackingIdentifier } from './landmarkGroups';
import { landmarkColors, ownColorRoles, setColors } from './landmarkColors';
import { attributionOf, HELD_NOTES, placementOf, seriesOfFrame } from './landmarkPlacement';
import {
  addLandmarkSetsOf, areLandmarkSetsVisible, clearCurrentLandmark, clearLandmarkSets, EVENTS, getCurrentLandmark, getLandmarkSet, getLandmarkSets,
  isLandmarkSetVisible, selectLandmark, setLandmarkSetsVisible, setLandmarkSetVisible, stepLandmarkSet, subscribe,
} from './landmarkSetStore';
import { landmarkDetailOf, markerShapeOf, setNameOf, typeBreakdownOf, typeTextOf } from './landmarkText';
import * as markers from './landmarkMarkers';
import * as volumeView from './landmarkVolumeView';
import { getFollowSelectedLandmark, setFollowSelectedLandmark, subscribeFollowSelectedLandmark } from './landmarkFollow';

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
  isLandmarkSetVisible,
  setLandmarkSetVisible,
  setLandmarkSetsVisible,
  areLandmarkSetsVisible,
  getCurrentLandmark,
  clearCurrentLandmark,
  selectLandmark,
  stepLandmarkSet,
  setNameOf,
  markerShapeOf,
  typeTextOf,
  landmarkDetailOf,
  typeBreakdownOf,
  // The markers of the slice views (landmarkMarkers.js) and the 3D volume view's geometry
  // (landmarkVolumeView.js)
  markers,
  volumeView,
  // "Follow selected landmark" (landmarkFollow.js)
  getFollowSelectedLandmark,
  setFollowSelectedLandmark,
  subscribeFollowSelectedLandmark,
};

export default landmarks;
