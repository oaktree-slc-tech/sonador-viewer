import { produce, setAutoFreeze } from 'immer';
import * as _ from 'lodash';

import {
  CLEAR_VIEWPORT,
  CLEAR_VIEWPORT_SPECIFIC_DATA,
  SET_ACTIVE_SPECIFIC_DATA,
  SET_SPECIFIC_DATA,
  SET_VIEWPORT,
  SET_VIEWPORT_ACTIVE,
  SET_VIEWPORT_LAYOUT,
  SET_VIEWPORT_LAYOUT_AND_DATA,
} from '../constants/ActionTypes';

setAutoFreeze(false);

export const DEFAULT_STATE = {
  numRows: 1,
  numColumns: 1,
  activeViewportIndex: 0,
  layout: {
    viewports: [{}],
  },
  viewportSpecificData: {},
};


const findActiveViewportSpecificData = (numRows, numColumns, currentViewportSpecificData = {}) => {
  /**
  *  Take the new number of Rows and Columns, delete all not used viewport data and also set
  *  active viewport as default in case current one is not available anymore.
  *
  * @param {Number} numRows
  * @param {Number} numColumns
  * @param {Object} currentViewportSpecificData
  * @returns
  */

  const numberOfViewports = numRows * numColumns;
  const viewportSpecificData = _.cloneDeep(currentViewportSpecificData);

  // Guard against malformed dimensions (a missing/misspelled numRows or numColumns makes this
  // NaN). Every NaN comparison below is false, so the stale data would be kept silently.
  if (!Number.isFinite(numberOfViewports) || numberOfViewports < 1) {
    return viewportSpecificData;
  }

  // Data is keyed by viewport index, so compare each key against the new layout rather than
  // gating on the total key count: a sparse set of keys (indices cleared, but not deleted) can
  // hold an out-of-range index without the count exceeding the number of viewports.
  Object.keys(viewportSpecificData).forEach((key) => {
    if (Number(key) > numberOfViewports - 1) {
      delete viewportSpecificData[key];
    }
  });

  return viewportSpecificData;
};


const getActiveViewportIndex = (numRows, numColumns, currentActiveViewportIndex) => {
  /**
  *  Take new number of Rows and Columns and make sure the current active viewport index is still available, if not, return the default
  *
  * @param {Number} numRows
  * @param {Number} numColumns
  * @param {Number} currentActiveViewportIndex
  * @returns
  */
  const numberOfViewports = numRows * numColumns;

  return currentActiveViewportIndex > numberOfViewports - 1
    ? DEFAULT_STATE.activeViewportIndex
    : currentActiveViewportIndex;
};


const viewports = (state = DEFAULT_STATE, action) => {
  /**
  * The definition of a viewport action.
  *
  * @typedef {Object} ViewportAction
  * @property {string} type -
  * @property {Object} data -
  * @property {Object} layout -
  * @property {number} viewportIndex -
  * @property {Object} viewportSpecificData -
  */

  /**
  * @param {Object} [state=DEFAULT_STATE] The current viewport state.
  * @param {ViewportAction} action A viewport action.
  */
  let useActiveViewport = false;

  switch (action.type) {
    /**
     * Sets the active viewport index.
     *
     * @return {Object} New state.
     */
    case SET_VIEWPORT_ACTIVE: {
      return produce(state, (draftState) => {
        draftState.activeViewportIndex = getActiveViewportIndex(
          draftState.numRows,
          draftState.numColumns,
          action.viewportIndex
        );
      });
    }

    /**
     * Sets viewport layout.
     *
     * @return {Object} New state.
     */
    case SET_VIEWPORT_LAYOUT: {
      const { numRows, numColumns } = action;
      const viewportSpecificData = findActiveViewportSpecificData(numRows, numColumns, state.viewportSpecificData);
      const activeViewportIndex = getActiveViewportIndex(numRows, numColumns, state.activeViewportIndex);

      return {
        ...state,
        numRows: action.numRows,
        numColumns: action.numColumns,
        layout: { viewports: [...action.viewports] },
        viewportSpecificData,
        activeViewportIndex,
      };
    }

    /**
     * Sets viewport layout and data.
     *
     * @return {Object} New state.
     */
    case SET_VIEWPORT_LAYOUT_AND_DATA: {
      const { numRows, numColumns } = action;
      const viewportSpecificData = findActiveViewportSpecificData(numRows, numColumns, action.viewportSpecificData);
      const activeViewportIndex = getActiveViewportIndex(numRows, numColumns, state.activeViewportIndex);

      return {
        ...state,
        numRows: action.numRows,
        numColumns: action.numColumns,
        layout: { viewports: [...action.viewports] },
        viewportSpecificData,
        activeViewportIndex,
      };
    }

    /**
     * Sets viewport specific data of active viewport.
     *
     * @return {Object} New state.
     */
    case SET_VIEWPORT: {
      return produce(state, (draftState) => {
        draftState.viewportSpecificData[action.viewportIndex] =
          draftState.viewportSpecificData[action.viewportIndex] || {};

        Object.keys(action.viewportSpecificData).forEach((key) => {
          draftState.viewportSpecificData[action.viewportIndex][key] = action.viewportSpecificData[key];
        });

        // Create a placeholder in the draftState for the viewportIndex (if it doesn't already exist)
        if (action.viewportSpecificData && _.isUndefined(draftState.layout.viewports[action.viewportIndex])) {
          draftState.layout.viewports[action.viewportIndex] = {};
        }

        // Set plugin for the viewport
        if (action.viewportSpecificData && action.viewportSpecificData.plugin) {
          draftState.layout.viewports[action.viewportIndex].plugin = action.viewportSpecificData.plugin;
        }
      });
    }

    /**
     * Sets viewport specific data of active/any viewport.
     *
     * @return {Object} New state.
     */
    case SET_ACTIVE_SPECIFIC_DATA:
      useActiveViewport = true;
    // Allow fall-through
    // eslint-disable-next-line
    case SET_SPECIFIC_DATA: {
      const layout = _.cloneDeep(state.layout);
      const viewportIndex = useActiveViewport ? state.activeViewportIndex : action.viewportIndex;

      let viewportSpecificData = _.cloneDeep(state.viewportSpecificData);
      viewportSpecificData[viewportIndex] = {
        ...action.viewportSpecificData,
      };

      if (action.viewportSpecificData && action.viewportSpecificData.plugin) {
        layout.viewports[viewportIndex].plugin = action.viewportSpecificData.plugin;
      }

      return { ...state, layout, viewportSpecificData };
    }

    /**
     * Clears viewport specific data of any viewport.
     *
     * @return {Object} New state.
     */
    case CLEAR_VIEWPORT: {
      let viewportSpecificData = _.cloneDeep(state.viewportSpecificData);

      if (action.viewportIndex) {
        viewportSpecificData[action.viewportIndex] = {};
        return { ...state, viewportSpecificData };
      } else {
        return DEFAULT_STATE;
      }
    }

    case CLEAR_VIEWPORT_SPECIFIC_DATA:
      return {
        ...state,
        viewportSpecificData: {},
      };

    /**
     * Returns the current application state.
     *
     * @return {Object} The current state.
     */
    default: {
      return state;
    }
  }
};


export default viewports;
