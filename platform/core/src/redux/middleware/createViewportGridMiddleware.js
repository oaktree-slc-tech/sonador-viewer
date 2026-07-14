import {
  CLEAR_VIEWPORT,
  CLEAR_VIEWPORT_SPECIFIC_DATA,
  SET_ACTIVE_SPECIFIC_DATA,
  SET_VIEWPORT,
  SET_VIEWPORT_ACTIVE,
  SET_VIEWPORT_LAYOUT,
  SET_VIEWPORT_LAYOUT_AND_DATA,
} from '../constants/ActionTypes';


export default function createViewportGridMiddleware({ viewportGridService }) {
  // Trigger OHIF v3 service methods in response to Redux viewport grid actions

  return store => next => action => {
    const result = next(action);

    if (!viewportGridService) {
      return result;
    }    

    switch (action.type) {
      case SET_VIEWPORT_ACTIVE:
        viewportGridService.setActiveViewportId(action.viewportIndex);
        break;

      case SET_VIEWPORT_LAYOUT:
        viewportGridService.setLayout({ 
          numRows: action.numRows, numCols: action.numColumns, layoutOptions: action.layoutOptions,
        });
        viewportGridService.set(action);
        break;

      case SET_VIEWPORT_LAYOUT_AND_DATA:
        viewportGridService.setLayout({ 
          numRows: action.numRows, numCols: action.numColumns, layoutOptions: action.layoutOptions,
        });
        viewportGridService.set(action);
        break;

      case SET_VIEWPORT: {
        const state = viewportGridService.getState()
        viewportGridService.set({
          ...state,
          [action.viewportIndex]: action.viewportSpecificData,
        });
        break;
      }
        
      case SET_ACTIVE_SPECIFIC_DATA: {
        const state = store.getState();

        const activeViewportIndex = state.viewports?.activeViewportIndex;
        viewportGridService.setViewportSpecificData?.(
          activeViewportIndex,
          action.viewportSpecificData
        );
        break;
      }

      case CLEAR_VIEWPORT: {
        const state = viewportGridService.getState();
        state[action.viewportIndex] = {};
        viewportGridService.set(state);
        break;
      }
        

      case CLEAR_VIEWPORT_SPECIFIC_DATA:
        viewportGridService.reset();
        break;

      default:
        break;
    }

    return result;
  };
}