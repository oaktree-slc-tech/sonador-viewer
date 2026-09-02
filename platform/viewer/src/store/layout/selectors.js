// Held so an unchanged context list keeps its identity between calls. Without it this selector
// returns a new array every time, which makes `useSelector` re-render AppContext -- and therefore
// the whole tree below it -- on every store notification, and trips react-redux's stability check.
let _lastActiveContexts = null;

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

  if (
    _lastActiveContexts &&
    _lastActiveContexts.length === activeContexts.length &&
    _lastActiveContexts.every((context, i) => context === activeContexts[i])
  ) {
    return _lastActiveContexts;
  }

  _lastActiveContexts = activeContexts;
  return activeContexts;
};
