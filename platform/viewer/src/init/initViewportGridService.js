/**
 * Initializes the ViewportGridService with a Redux-backed implementation.
 *
 * OHIF v3's ViewportGridService is a thin facade that delegates all work to
 * an injected implementation (normally provided by ViewportGridProvider in a
 * React context). In the Sonador Viewer, Redux already manages viewport/grid
 * state, so we inject a read-only implementation that projects Redux state into
 * the shape the service expects while leaving all mutations as no-ops.
 *
 * This keeps SegmentationService and other OHIF v3 services that depend on
 * ViewportGridService functional without requiring a parallel state tree.
 */
export function initViewportGridService({ viewportGridService, store }) {
  const getReduxViewports = () => store.getState().viewports;

  const getState = () => {
    const { numRows, numColumns, activeViewportIndex, viewportSpecificData = {} } = getReduxViewports();

    const viewports = new Map(
      Object.entries(viewportSpecificData).map(([index, data]) => {
        const id = String(index);
        return [id, {
          viewportId: id,
          displaySetInstanceUIDs: data?.displaySetInstanceUIDs ?? [],
          viewportOptions: {},
          displaySetSelectors: [],
          displaySetOptions: [],
          x: 0,
          y: 0,
          width: 1 / (numColumns || 1),
          height: 1 / (numRows || 1),
          viewportLabel: null,
          isReady: true,
          ...data,
        }];
      })
    );

    return {
      activeViewportId: String(activeViewportIndex ?? 0),
      layout: {
        numRows: numRows ?? 1,
        numCols: numColumns ?? 1,
        layoutType: 'grid',
      },
      isHangingProtocolLayout: false,
      viewports,
    };
  };

  viewportGridService.setServiceImplementation({
    getState,
    getViewportState: (viewportId) => getState().viewports.get(viewportId) ?? null,
    getNumViewportPanes: () => {
      const { numRows = 1, numColumns = 1 } = getReduxViewports();
      return numRows * numColumns;
    },
    // Mutations are no-ops: Redux reducers handle all state changes via the
    // ViewportGridMiddleware. These stubs exist so that OHIF v3 service methods
    // that call them (e.g. reset, onModeExit) do not throw.
    setActiveViewportId: () => {},
    setDisplaySetsForViewports: async () => {},
    setLayout: async () => {},
    reset: () => {},
    onModeExit: () => {},
    set: () => {},
    setViewportIsReady: () => {},
  });
}
