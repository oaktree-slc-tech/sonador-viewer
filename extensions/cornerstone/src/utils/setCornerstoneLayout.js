import { redux } from '@ohif/core';

const { setLayout } = redux.actions;


const setCornerstoneLayout = () => {
  /**
  * Update the current layout with a simple Cornerstone one
  *
  * @return void
  */
  const layout = {
    numRows: 1,
    numColumns: 1,
    viewports: [{ plugin: 'cornerstone' }],
  };

  const action = setLayout(layout);

  window.store.dispatch(action);
}


export default setCornerstoneLayout;
