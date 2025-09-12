/** Action Creators:
 *  https://redux.js.org/basics/actions#action-creators
 */

import {
  CLEAR_VIEWPORT,
  CLEAR_VIEWPORT_SPECIFIC_DATA,
  SET_ACTIVE_SERVER,
  SET_ACTIVE_SPECIFIC_DATA,
  SET_SERVERS,
  SET_USER_PREFERENCES,
  SET_VIEWPORT,
  SET_VIEWPORT_ACTIVE,
  SET_VIEWPORT_LAYOUT,
  SET_VIEWPORT_LAYOUT_AND_DATA,
} from './constants/ActionTypes.js';


/**
 * VIEWPORT
 */

/**
 * The definition of a viewport layout.
 *
 * @typedef {Object} ViewportLayout
 * @property {number} numRows -
 * @property {number} numColumns -
 * @property {array} viewports -
 */

export const setViewportSpecificData = (viewportIndex, viewportSpecificData) => ({
  type: SET_VIEWPORT,
  viewportIndex,
  viewportSpecificData,
});


export const setViewportActive = (viewportIndex) => ({
  type: SET_VIEWPORT_ACTIVE,
  viewportIndex,
});


export const setLayout = ({ numRows, numColumns, viewports }) => ({
  /**
  * @param {ViewportLayout} layout
  */
  type: SET_VIEWPORT_LAYOUT,
  numRows,
  numColumns,
  viewports,
});


export const setViewportLayoutAndData = ({ numRows, numColumns, viewports }, viewportSpecificData) => ({
  /**
  * @param {number} layout.numRows
  * @param {number} layout.numColumns
  * @param {array} viewports
  */
  type: SET_VIEWPORT_LAYOUT_AND_DATA,
  numRows,
  numColumns,
  viewports,
  viewportSpecificData,
});


// TODO probably we don't need this action, and need to use only 'clearEntireViewportSpecificData'
export const clearViewportSpecificData = (viewportIndex) => ({
  type: CLEAR_VIEWPORT,
  viewportIndex,
});


export const clearEntireViewportSpecificData = () => ({
  type: CLEAR_VIEWPORT_SPECIFIC_DATA,
});


export const setActiveViewportSpecificData = (viewportSpecificData) => ({
  type: SET_ACTIVE_SPECIFIC_DATA,
  viewportSpecificData,
});


/**
 * NOT-VIEWPORT
 */
export const setUserPreferences = (state) => ({
  type: SET_USER_PREFERENCES,
  state,
});

export const setExtensionData = (extension, data) => ({
  type: 'SET_EXTENSION_DATA',
  extension,
  data,
});

export const setTimepoints = (state) => ({
  type: 'SET_TIMEPOINTS',
  state,
});

export const setMeasurements = (state) => ({
  type: 'SET_MEASUREMENTS',
  state,
});

export const setStudyData = (StudyInstanceUID, data) => ({
  type: 'SET_STUDY_DATA',
  StudyInstanceUID,
  data,
});

export const setServers = (servers) => ({
  type: SET_SERVERS,
  servers,
});

export const setActiveServer = (token) => {
  return {
    type: SET_ACTIVE_SERVER,
    payload: token,
  };
};



const actions = {
  
  /**
   * VIEWPORT
   */
  setViewportActive,
  setViewportSpecificData,
  setViewportLayoutAndData,
  setLayout,
  clearViewportSpecificData,
  clearEntireViewportSpecificData,
  setActiveViewportSpecificData,
  
  /**
   * NOT-VIEWPORT
   */
  setUserPreferences,
  setExtensionData,
  setTimepoints,
  setMeasurements,
  setStudyData,
  setServers,
  setActiveServer,
};

export default actions;
