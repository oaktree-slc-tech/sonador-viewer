// Tool selection in the 3D Inspector: each measurement tool (Length, Angle, Cobb angle, arrow
// annotation, and the bidirectional, ellipse, rectangle, freehand and probe tools) takes the
// primary button for creation, the others stay passive so their annotations remain editable, and
// returning to a navigation tool leaves every measurement tool passive. The view is exercised as a
// plain object; its base class and Cornerstone3D are stubbed.

const mockGroup = { modes: {}, bindings: {} };
jest.mock('@cornerstonejs/core', () => ({
  RenderingEngine: class {}, Enums: {}, init: jest.fn(), volumeLoader: {}, cache: {},
}), { virtual: true });
jest.mock('@cornerstonejs/tools', () => {
  const tool = toolName => ({ toolName });
  return {
    init: jest.fn(),
    Enums: { MouseBindings: { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 524288 }, Events: {} },
    WindowLevelTool: tool('WindowLevel'),
    ZoomTool: tool('Zoom'),
    PanTool: tool('Pan'),
    StackScrollTool: tool('StackScroll'),
    AngleTool: tool('Angle'),
    CobbAngleTool: tool('CobbAngle'),
    LengthTool: tool('Length'),
    ArrowAnnotateTool: tool('ArrowAnnotate'),
    BidirectionalTool: tool('Bidirectional'),
    EllipticalROITool: tool('EllipticalROI'),
    RectangleROITool: tool('RectangleROI'),
    PlanarFreehandROITool: tool('PlanarFreehandROI'),
    ProbeTool: tool('Probe'),
    ReferenceLinesTool: tool('ReferenceLines'),
    OverlayGridTool: tool('OverlayGrid'),
    OrientationMarkerTool: tool('OrientationMarker'),
    ScaleOverlayTool: tool('ScaleOverlay'),
    addTool: jest.fn(),
    ToolGroupManager: { getToolGroup: () => mockGroup },
    annotation: { selection: {} },
    cancelActiveManipulations: jest.fn(),
    segmentation: {},
  };
}, { virtual: true });
jest.mock('@ohif/core', () => ({ __esModule: true, default: { display: { DisplaySetApi: {} } } }), { virtual: true });
jest.mock('@ohif/ui', () => ({ OHIFModal: () => null, Icon: () => null, ToolbarButton: () => null }), { virtual: true });
jest.mock('../utils/cornerstone3d.js', () => ({ getVolumeIdForDisplaySet: jest.fn(), inspectVtkLabelmapImage: jest.fn() }));
jest.mock('../enums', () => ({ __esModule: true, default: {} }));
jest.mock('./Cornerstone3DLabelmapBaseView.js', () => {
  class Base { setState() {} }
  Base.state = {};
  Base.defaultProps = {};
  Base.propTypes = {};
  return { __esModule: true, default: Base };
});
jest.mock('./tools/ViewportGridOverlayTool.js', () => ({ __esModule: true, default: { toolName: 'ViewportGridOverlay' } }));
jest.mock('./tools/DICOMSRDisplayTool', () => ({ addSRDisplayToolToGroup: jest.fn() }));

import Cornerstone3DInspectionView from './Cornerstone3DInspectionView';

const PRIMARY = 1;
const MODES = [
  ['length-tool', 'Length'], ['angle-tool', 'Angle'], ['cobb-angle-tool', 'CobbAngle'], ['arrow-tool', 'ArrowAnnotate'],
  ['bidirectional-tool', 'Bidirectional'], ['ellipse-tool', 'EllipticalROI'], ['rectangle-tool', 'RectangleROI'],
  ['freehand-tool', 'PlanarFreehandROI'], ['probe-tool', 'Probe'],
];
const MEASUREMENT_TOOLS = MODES.map(([, toolName]) => toolName);

beforeEach(() => {
  mockGroup.modes = {};
  mockGroup.bindings = {};
  mockGroup.setToolActive = jest.fn((name, options) => {
    mockGroup.modes[name] = 'Active';
    (options?.bindings || []).forEach(({ mouseButton }) => { mockGroup.bindings[mouseButton] = name; });
  });
  mockGroup.setToolPassive = jest.fn(name => {
    mockGroup.modes[name] = 'Passive';
    Object.keys(mockGroup.bindings).forEach(button => {
      if (mockGroup.bindings[button] === name) {
        delete mockGroup.bindings[button];
      }
    });
  });
});

const view = () => {
  const component = Object.create(Cornerstone3DInspectionView.prototype);
  component.props = { toolGroupId: 'inspection' };
  component.state = { toolMode: 'default' };
  component.setState = jest.fn(update => Object.assign(component.state, update));
  component.render3d = jest.fn();
  return component;
};

it.each(MODES)(
  '%s gives %s the primary button, the other measurement tools stay passive (editable)', (mode, toolName) => {
    const component = view();
    component.activateTools(mode);

    expect(mockGroup.bindings[PRIMARY]).toBe(toolName);
    MEASUREMENT_TOOLS.filter(name => name !== toolName).forEach(name => expect(mockGroup.modes[name]).toBe('Passive'));
    expect(component.state.toolMode).toBe(mode);
  });

it('switches from Length to Angle without Length keeping the primary button', () => {
  const component = view();
  component.activateTools('length-tool');
  component.activateTools('angle-tool');

  expect(mockGroup.bindings[PRIMARY]).toBe('Angle');
  expect(mockGroup.modes.Length).toBe('Passive');
});

it.each(['default', 'stack-scroll', 'zoom', 'pan'])('returns to navigation (%s) with every measurement tool passive', mode => {
  const component = view();
  component.activateTools('cobb-angle-tool');
  component.activateTools('arrow-tool');
  component.activateTools('ellipse-tool');
  component.activateTools('length-tool');
  component.activateTools(mode);

  expect(MEASUREMENT_TOOLS.includes(mockGroup.bindings[PRIMARY])).toBe(false);
  MEASUREMENT_TOOLS.forEach(name => expect(mockGroup.modes[name]).toBe('Passive'));
});

it.each([['bidirectional-tool', 'bidirectionalToolActive'], ['probe-tool', 'probeToolActive']])(
  'selecting %s marks only that tool selected', (mode, stateKey) => {
    const component = view();
    component.activateLengthTool();
    component.activateSessionTool(mode);

    expect(component.state[stateKey]).toBe(true);
    expect(component.state.lengthToolActive).toBe(false);
    expect(component.state.toolMode).toBe(mode);
  });

// The toolbar buttons of a rendered view, by label (ToolbarButton turns isToggle and isActive into
// aria-pressed; platform/ui ToolbarButton.test.js)
const toolbarButtons = component => {
  const found = {};
  const walk = node => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && node.props) {
      if (node.props.label) {
        found[node.props.label] = node.props;
      }
      walk(node.props.children);
    }
  };
  walk(component.render());
  return found;
};

it('exposes the selected tool as the one pressed toggle, following tool changes and the return to navigation', () => {
  const component = view();
  component.container = { current: null };
  const TOOLS = ['Stack Scroll', 'Zoom', 'Levels', 'Pan', 'Length', 'Angle', 'Cobb Angle', 'Annotate',
    'Bidirectional', 'Ellipse', 'Rectangle', 'Freehand', 'Probe'];
  const pressed = () => TOOLS.filter(label => toolbarButtons(component)[label].isActive);

  TOOLS.forEach(label => expect(toolbarButtons(component)[label].isToggle).toBe(true));
  component.activateSessionTool('ellipse-tool');
  expect(pressed()).toEqual(['Ellipse']);
  component.activateSessionTool('probe-tool');
  expect(pressed()).toEqual(['Probe']);
  component.activateCobbAngleTool();
  expect(pressed()).toEqual(['Cobb Angle']);
  component.activateLevelTool();
  expect(pressed()).toEqual(['Levels']);
});

it('removes a drawing cancelled with Escape in the same key handler that cancels it', () => {
  const tools = require('@cornerstonejs/tools');
  const order = [];
  tools.cancelActiveManipulations.mockImplementation(() => { order.push('cancel'); return 'drawing-1'; });
  tools.annotation.state = { removeAnnotation: jest.fn(uid => order.push(`remove ${uid}`)) };

  view().keyboardEvent({ detail: { element: 'element', key: 'Escape' } });
  expect(order).toEqual(['cancel', 'remove drawing-1']);
});

it("opens on the MPR pane's plane and slice once the volume is set, fitted to the resized view", async () => {
  const _ = jest.requireActual('lodash');
  const order = [];
  const component = view();
  const viewport = { setCamera: jest.fn(), resetCamera: jest.fn(() => order.push('fit')) };
  component.renderEngine = { resize: jest.fn(() => order.push('resize')) };
  const camera = { viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1], focalPoint: [5, 6, 7], position: [105, 6, 7], parallelScale: 80 };
  component.props = { ...component.props, initialCamera: camera };
  component._checkViewportActive = () => ({ viewport });
  const base = Object.getPrototypeOf(Cornerstone3DInspectionView.prototype);
  base._setImageVolume = jest.fn(async () => order.push('setVolumes'));
  viewport.setCamera.mockImplementation(() => order.push('setCamera'));

  await component._setImageVolume();
  expect(order).toEqual(['setVolumes', 'resize', 'setCamera', 'fit']);
  expect(viewport.setCamera).toHaveBeenCalledWith(_.omit(camera, 'parallelScale'));
  expect(component.renderEngine.resize).toHaveBeenCalledWith(true, true);

  component.props = { ...component.props, initialCamera: undefined };
  viewport.setCamera.mockClear();
  await component._setImageVolume();
  expect(viewport.setCamera).not.toHaveBeenCalled();
});
