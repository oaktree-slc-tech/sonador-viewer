import { setLayoutAndViewportData } from '@ohif/ui';

export default function setViewportToVTK(displaySet, viewportIndex, numRows, numColumns, layout, viewportSpecificData) {
  return new Promise((resolve, reject) => {
    // Set the active viewport to the VTK viewer

    const viewports = layout.viewports.slice();

    viewports[viewportIndex] = Object.assign({}, viewports[viewportIndex], {
      // plugin: 'vtk',
      vtk: {
        mode: 'mpr',
        afterCreation: (api) => {
          resolve(api);
        },
      },
    });

    const updatedViewportData = viewportSpecificData;

    setLayoutAndViewportData(
      {
        numRows,
        numColumns,
        viewports,
      },
      updatedViewportData
    );
  });
}
