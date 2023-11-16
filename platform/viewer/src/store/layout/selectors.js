export const getActiveContexts = (state) => {
  const {
    activeViewportIndex,
    layout: { viewports },
    viewportSpecificData,
  } = state.viewports;
  const activeContexts = ['VIEWER'];
  const activeLayoutViewport = viewports[activeViewportIndex] || {};
  const activeViewportSpecificData = viewportSpecificData[activeViewportIndex] || {};
  const activeViewportPluginName = activeLayoutViewport.plugin || activeViewportSpecificData.plugin;

  if (activeViewportPluginName) {
    const activeViewportExtension = `ACTIVE_VIEWPORT::${activeViewportPluginName.toUpperCase()}`;
    activeContexts.push(activeViewportExtension);
  }

  return activeContexts;
};
