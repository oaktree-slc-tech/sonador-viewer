import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import classNames from 'classnames';
import memoize from 'lodash/memoize';
import PropTypes from 'prop-types';

import { MODULE_TYPES, utils } from '@ohif/core';
import { useLogger, useSnackbarContext } from '@ohif/ui';

import { extensionManager } from '../../App';

import DefaultViewport from './DefaultViewport';
import EmptyViewport from './EmptyViewport';
//
import ViewportPane from './ViewportPane';

import './ViewportGrid.css';

const { loadAndCacheDerivedDisplaySets } = utils;

const getAvailableViewportModules = memoize((viewportModules) => {
  const availableViewportModules = {};
  viewportModules.forEach((moduleDefinition) => {
    availableViewportModules[moduleDefinition.extensionId] = moduleDefinition.module;
  });
  return availableViewportModules;
});


function ViewportGrid({ setViewportData, studies = [], viewportData = [], isStudyLoaded }) {
  const {
    numColumns = 1,
    numRows = 1,
    layout = { viewports: [{}] },
    activeViewportIndex = 0,
    availablePlugins = {
      DefaultViewport,
    },
    defaultPlugin: defaultPluginName = 'defaultViewportPlugin',
  } = useSelector((state) => {
    const viewportModules = extensionManager.modules[MODULE_TYPES.VIEWPORT];
    const availableViewportModules = getAvailableViewportModules(viewportModules);

    // TODO: Use something like state.plugins.defaultPlugin[MODULE_TYPES.VIEWPORT]
    let defaultPlugin;
    if (viewportModules.length) {
      defaultPlugin = viewportModules[0].extensionId;
    }

    const { numRows, numColumns, layout, activeViewportIndex } = state.viewports;

    return {
      numRows,
      numColumns,
      layout,
      activeViewportIndex,
      // TODO: rename `availableViewportModules`
      availablePlugins: availableViewportModules,
      // TODO: rename `defaultViewportModule`
      defaultPlugin,
    };
  });

  const rowSize = 100 / numRows;
  const colSize = 100 / numColumns;

  const snackbar = useSnackbarContext();
  const logger = useLogger();

  useEffect(() => {
    if (isStudyLoaded) {
      viewportData.forEach((displaySet) => {
        loadAndCacheDerivedDisplaySets(displaySet, studies, logger, snackbar);
      });
    }
  }, [studies, viewportData, isStudyLoaded, snackbar]);

  // http://grid.malven.co/
  if (!viewportData?.length) {
    return null;
  }

  return (
    <div
      data-cy="viewprt-grid"
      style={{
        display: 'grid',
        gridTemplateRows: `repeat(${numRows}, ${rowSize}%)`,
        gridTemplateColumns: `repeat(${numColumns}, ${colSize}%)`,
        height: '100%',
        width: '100%',
      }}
    >
      {layout.viewports.map((layout, viewportIndex) => {
        const displaySet = viewportData[viewportIndex];

        if (!displaySet) {
          return null;
        }

        const data = {
          displaySet,
          studies,
        };

        const pluginName = !layout.plugin && displaySet && displaySet.plugin ? displaySet.plugin : layout.plugin;

        return (
          <ViewportPane
            onDrop={setViewportData}
            viewportIndex={viewportIndex} // Needed by `setViewportData`
            className={classNames('viewport-container', {
              active: activeViewportIndex === viewportIndex,
            })}
            key={viewportIndex}
          >
            <Viewport
              viewportData={data}
              viewportIndex={viewportIndex}
              availablePlugins={availablePlugins}
              pluginName={pluginName}
              defaultPluginName={defaultPluginName}
            />
          </ViewportPane>
        );
      })}
    </div>
  );
}

ViewportGrid.propTypes = {
  viewportData: PropTypes.array.isRequired,
  setViewportData: PropTypes.func.isRequired,
  studies: PropTypes.array,
  isStudyLoaded: PropTypes.bool,
};

function Viewport({ viewportData, viewportIndex, availablePlugins, pluginName, defaultPluginName }) {
  if (viewportData.displaySet) {
    pluginName = pluginName || defaultPluginName;
    const ViewportComponent = availablePlugins[pluginName];

    if (!ViewportComponent) {
      throw new Error(
        `No Viewport Component available for name ${pluginName}.
         Available plugins: ${JSON.stringify(availablePlugins)}`
      );
    }

    return <ViewportComponent viewportData={viewportData} viewportIndex={viewportIndex} />;
  }

  return <EmptyViewport />;
}

export default ViewportGrid;
