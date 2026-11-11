import setLayoutAndViewportData from './setLayoutAndViewportData.js';

export default function setMultiPanelLayout(
  displaySet,
  viewportPropsArray,
  numRows = 1,
  numColumns = 1,
  plugin = 'cornerstone',
  mode = null
) {
  // Create multi-panel layout
  return new Promise((resolve, reject) => {
    const viewports = [];
    const numViewports = numRows * numColumns;

    if (viewportPropsArray && viewportPropsArray.length !== numViewports) {
      reject(new Error('viewportProps is supplied but its length is not equal to numViewports'));
    }

    // The viewports show a copy of the display set: the caller's may be the study's own display
    // set, and tagging that with the plugin would reopen this view whenever the series is shown again
    const viewportDisplaySet = Object.assign(Object.create(Object.getPrototypeOf(displaySet)), displaySet, { plugin });
    const viewportSpecificData = {};

    for (let i = 0; i < numViewports; i++) {
      viewports.push({});
      viewportSpecificData[i] = viewportDisplaySet;
    }

    const apis = [];
    viewports.forEach((viewport, index) => {
      apis[index] = null;
      const viewportProps = viewportPropsArray[index];

      // Nested property array
      const nestedViewportProps = {};
      nestedViewportProps[plugin] = {
        mode: mode,
        afterCreation: (api) => {
          apis[index] = api;

          if (apis.every((a) => !!a)) {
            resolve(apis);
          }
        },
        ...viewportProps,
      };

      // Viewport properties
      viewports[index] = Object.assign({}, viewports[index], nestedViewportProps);
    });

    setLayoutAndViewportData(
      {
        numRows,
        numColumns,
        viewports,
      },
      viewportSpecificData
    );
  });
}
