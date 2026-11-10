// Measurements in the MPR view: the MPR panes carry every measurement tool type the viewer's
// Cornerstone3D views offer (passive: drawn, editable while pending), registered once, and
// `jumpToMprWorldPoint` brings a point into view in every pane.

const mockGroup = { tools: {}, viewports: [] };
const mockRegistered = {};
const mockPanes = [];
const mockRender = jest.fn();

jest.mock('@cornerstonejs/core', () => ({
  getRenderingEngine: id => (id === 'vtk-mprslice' ? { getViewports: () => mockPanes, render: mockRender } : undefined),
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => {
  const tool = toolName => ({ toolName });
  return {
    ToolGroupManager: {
      getToolGroup: () => (mockGroup.created ? mockGroup : undefined),
      createToolGroup: () => {
        mockGroup.created = true;
        return mockGroup;
      },
    },
    SynchronizerManager: {},
    WindowLevelTool: tool('WindowLevel'),
    CrosshairsTool: tool('Crosshairs'),
    ZoomTool: tool('Zoom'),
    PanTool: tool('Pan'),
    StackScrollTool: tool('StackScroll'),
    TrackballRotateTool: tool('TrackballRotate'),
    LengthTool: tool('Length'),
    ArrowAnnotateTool: tool('ArrowAnnotate'),
    AngleTool: tool('Angle'),
    CobbAngleTool: tool('CobbAngle'),
    BidirectionalTool: tool('Bidirectional'),
    EllipticalROITool: tool('EllipticalROI'),
    RectangleROITool: tool('RectangleROI'),
    PlanarFreehandROITool: tool('PlanarFreehandROI'),
    ProbeTool: tool('Probe'),
    state: { tools: mockRegistered },
    Enums: { MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4 } },
    addTool: jest.fn(toolClass => { mockRegistered[toolClass.toolName] = toolClass; }),
    segmentation: {},
  };
}, { virtual: true });
jest.mock('@cornerstonejs/tools/enums', () => ({ SegmentationRepresentations: {} }), { virtual: true });
jest.mock('@cornerstonejs/tools/synchronizers', () => ({ createVOISynchronizer: jest.fn() }), { virtual: true });
jest.mock('@ohif/core', () => ({ __esModule: true, default: { display: { DisplaySetApi: {} } } }), { virtual: true });
jest.mock('@ohif/extension-cornerstone', () => ({ utils: {} }), { virtual: true });
jest.mock('./utils/setMPRLayout.js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('./utils/cornerstone3d.js', () => ({ getCornerstone3dViewport: jest.fn() }));
jest.mock('./components/tools/DICOMSRDisplayTool', () => ({ addSRDisplayToolToGroup: jest.fn() }));
jest.mock('./enums', () => ({
  Enums: { MPR: { VTK_MPRSLICE_RENDER_ID: 'vtk-mprslice', VTK_MPRSLICE_TOOLGROUP_ID: 'vtk-mprslice', TOOLS: {} }, VIEWPORT: 'VIEWPORT' },
}));

const MEASUREMENT_TOOLS = ['Length', 'ArrowAnnotate', 'Angle', 'CobbAngle', 'Bidirectional', 'EllipticalROI',
  'RectangleROI', 'PlanarFreehandROI', 'Probe'];

let actions;
beforeEach(() => {
  Object.keys(mockRegistered).forEach(key => delete mockRegistered[key]);
  Object.assign(mockGroup, { created: false, tools: {}, viewports: [] });
  mockGroup.addTool = jest.fn(name => { mockGroup.tools[name] = 'Disabled'; });
  mockGroup.setToolPassive = jest.fn(name => { mockGroup.tools[name] = 'Passive'; });
  mockGroup.setToolActive = jest.fn(name => { mockGroup.tools[name] = 'Active'; });
  mockGroup.addViewport = jest.fn(id => mockGroup.viewports.push(id));
  mockPanes.length = 0;
  mockRender.mockClear();
  const commandsModule = require('./commandsModule').default;
  ({ definitions: actions } = commandsModule({ commandsManager: {}, servicesManager: { services: {} } }));
});

const pane = () => ({ id: `pane-${mockPanes.length}`, element: {} });

it('gives the MPR panes every measurement tool type, passive', () => {
  const component = { state: { toolMode: 'crosshairs' }, _checkViewportActive: () => ({ viewportId: 'axial', viewport: pane() }) };
  actions.initMprTools.commandFn({ toolGroupId: 'vtk-mprslice', component });

  MEASUREMENT_TOOLS.forEach(name => expect(mockGroup.tools[name]).toBe('Passive'));
  MEASUREMENT_TOOLS.forEach(name => expect(mockRegistered[name]).toBeDefined());
});

it('registers a tool only when no other view has (the exchange angle tools stay registered)', () => {
  const exchangeAngle = { toolName: 'Angle', exchange: true };
  mockRegistered.Angle = exchangeAngle;
  const component = { state: {}, _checkViewportActive: () => ({ viewportId: 'axial', viewport: pane() }) };
  actions.initMprTools.commandFn({ toolGroupId: 'vtk-mprslice', component });
  expect(mockRegistered.Angle).toBe(exchangeAngle);
});

it('brings a point into view in every MPR pane and renders once', () => {
  const panes = [0, 1, 2].map(() => {
    const viewport = pane();
    viewport.camera = { focalPoint: [0, 0, 0], position: [0, 0, -100], viewPlaneNormal: [0, 0, 1] };
    viewport.getCamera = () => ({ ...viewport.camera });
    viewport.setCamera = camera => Object.assign(viewport.camera, camera);
    viewport.worldToCanvas = () => [10, 10];
    viewport.canvas = { clientWidth: 100, clientHeight: 100 };
    return viewport;
  });
  mockPanes.push(...panes);

  expect(actions.jumpToMprWorldPoint.commandFn({ worldPoint: [5, 5, 30] })).toEqual({ panes: 3, drawn: true, limitDegrees: 15 });
  panes.forEach(viewport => expect(viewport.camera.focalPoint).toEqual([0, 0, 30]));
  expect(mockRender).toHaveBeenCalledTimes(1);
});


it('turns only the pane closest to the measurement plane onto it, then moves every pane', () => {
  const makePane = normal => {
    const viewport = pane();
    viewport.camera = { focalPoint: [0, 0, 0], position: normal.map(x => x * 100), viewPlaneNormal: normal, viewUp: normal[2] ? [0, -1, 0] : [0, 0, 1] };
    viewport.getCamera = () => ({ ...viewport.camera });
    viewport.setCamera = camera => Object.assign(viewport.camera, camera);
    viewport.worldToCanvas = () => [10, 10];
    viewport.canvas = { clientWidth: 100, clientHeight: 100 };
    return viewport;
  };
  const [axial, sagittal, coronal] = [makePane([0, 0, 1]), makePane([1, 0, 0]), makePane([0, -1, 0])];
  mockPanes.push(axial, sagittal, coronal);
  const oblique = [-0.9983, 0.0576, -0.0122];

  expect(actions.jumpToMprWorldPoint.commandFn({ worldPoint: [5, 5, 5], viewPlaneNormal: oblique }))
    .toEqual({ panes: 3, drawn: true, limitDegrees: 15 });
  expect(Math.abs(sagittal.camera.viewPlaneNormal[1])).toBeGreaterThan(0.05);
  expect(axial.camera.viewPlaneNormal).toEqual([0, 0, 1]);
  expect(coronal.camera.viewPlaneNormal).toEqual([0, -1, 0]);
});

it.each([20, 35])('leaves the panes as they are, and reports the measurement not drawn, %s° from the closest pane', (degrees) => {
  const makePane = normal => {
    const viewport = pane();
    viewport.camera = { focalPoint: [0, 0, 0], position: normal.map(x => x * 100), viewPlaneNormal: normal, viewUp: normal[2] ? [0, -1, 0] : [0, 0, 1] };
    viewport.getCamera = () => ({ ...viewport.camera });
    viewport.setCamera = camera => Object.assign(viewport.camera, camera);
    viewport.worldToCanvas = () => [10, 10];
    viewport.canvas = { clientWidth: 100, clientHeight: 100 };
    return viewport;
  };
  const panes = [makePane([0, 0, 1]), makePane([1, 0, 0]), makePane([0, -1, 0])];
  mockPanes.push(...panes);
  const before = panes.map(viewport => ({ ...viewport.camera }));
  // Tilted from the sagittal pane's normal about the patient's z axis
  const radians = (degrees * Math.PI) / 180;
  const oblique = [Math.cos(radians), Math.sin(radians), 0];

  expect(actions.jumpToMprWorldPoint.commandFn({ worldPoint: [5, 5, 5], viewPlaneNormal: oblique }))
    .toEqual({ panes: 3, drawn: false, limitDegrees: 15 });
  panes.forEach((viewport, i) => expect(viewport.camera).toEqual(before[i]));
  expect(mockRender).not.toHaveBeenCalled();
});
