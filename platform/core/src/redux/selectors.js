const getActiveViewportData = (state) => {
  // Retrieve display data for the currently active viewport
  const { viewports = {} } = state;
  const { viewportSpecificData, activeViewportIndex } = viewports;

  return {
    viewportSpecificData,
    activeViewportIndex,
  };
};

export { getActiveViewportData };
