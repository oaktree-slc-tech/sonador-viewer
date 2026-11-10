// The angle display draws every visible Angle and Cobb angle annotation of a 3D viewport's Frame of
// Reference, whatever the camera orientation, with the exchange value; it can be shown and hidden.
// Cornerstone3D is stubbed: annotations come from an in-memory store and drawing calls are recorded.

const mockAnnotations = { Angle: [], CobbAngle: [] };
const mockHidden = new Set();
const mockDrawn = [];
const mockRegisteredTools = {};
const mockRendered = [];

jest.mock('@cornerstonejs/core', () => ({
  utilities: { roundNumber: value => String(Math.round(value * 100) / 100) },
}), { virtual: true });

jest.mock('@cornerstonejs/tools', () => {
  class AnnotationTool {
    constructor(toolProps, defaultToolProps) {
      this.configuration = { ...defaultToolProps.configuration, ...(toolProps.configuration || {}) };
      this.toolGroupId = 'group';
    }
    getToolName() { return this.constructor.toolName; }
    getStyle(property) { return property === 'color' ? 'rgb(255, 255, 0)' : 1; }
    getLinkedTextBoxStyle() { return {}; }
  }
  const record = kind => (helper, uid, partUID, ...args) => mockDrawn.push({ kind, uid, partUID, args });
  return {
    AnnotationTool,
    addTool: ToolClass => { mockRegisteredTools[ToolClass.toolName] = ToolClass; },
    state: { get tools() { return mockRegisteredTools; } },
    annotation: {
      state: { getAnnotations: toolName => mockAnnotations[toolName] || [] },
      visibility: { isAnnotationVisible: uid => !mockHidden.has(uid) },
    },
    drawing: {
      drawHandles: record('handles'),
      drawLine: record('line'),
      drawPolyline: record('polyline'),
      drawLinkedTextBox: record('textBox'),
    },
    utilities: {
      drawing: { getTextBoxCoordsCanvas: points => points[0] },
      triggerAnnotationRenderForViewportIds: ids => mockRendered.push(ids),
    },
  };
}, { virtual: true });

import AngleDisplay3DTool, { addAngleDisplay3DToolToGroup, setAngleDisplay3DEnabled } from './AngleDisplay3DTool';

const FOR = '2.25.7001';
const angle = (uid, points, extra = {}) => ({
  annotationUID: uid, metadata: { toolName: 'Angle', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1] },
  data: { handles: { points } }, ...extra,
});
const cobbAngle = (uid, points, extra = {}) => ({
  annotationUID: uid, metadata: { toolName: 'CobbAngle', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1] },
  data: { handles: { points } }, ...extra,
});
// A 3D viewport looking along an oblique direction: not parallel to the annotations' plane
const viewport = {
  id: 'volume3d', element: {}, getActors: () => [{}], getFrameOfReferenceUID: () => FOR,
  worldToCanvas: point => [point[0] + point[2], point[1]],
};
const render = () => {
  mockDrawn.length = 0;
  return new AngleDisplay3DTool().renderAnnotation({ viewport }, {});
};
const textOf = uid => mockDrawn.filter(d => d.kind === 'textBox' && d.uid === uid).map(d => d.args[0]);

afterEach(() => {
  mockAnnotations.Angle = [];
  mockAnnotations.CobbAngle = [];
  mockHidden.clear();
});


it('draws an Angle and a Cobb angle of the Frame of Reference in a view that is not parallel to them', () => {
  mockAnnotations.Angle = [angle('a-1', [[10, 0, 0], [0, 0, 0], [0, 10, 0]])];
  mockAnnotations.CobbAngle = [cobbAngle('c-1', [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]])];

  expect(render()).toBe(true);
  expect(mockDrawn.filter(d => d.uid === 'a-1').map(d => d.kind)).toEqual(['polyline', 'handles', 'textBox']);
  expect(mockDrawn.filter(d => d.uid === 'c-1').map(d => d.kind)).toEqual(['line', 'line', 'handles', 'textBox']);
  expect(textOf('a-1')).toEqual([['90 °']]);
  expect(textOf('c-1')).toEqual([['135 °']]);
});

it('shows the classic record value while the points are unchanged, and 0 as a value', () => {
  const points = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]];
  mockAnnotations.CobbAngle = [
    cobbAngle('c-1', points.map(p => p.slice()), { data: { handles: { points: points.map(p => p.slice()) }, recordValue: { value: 123.456, points } } }),
    cobbAngle('c-2', [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]),
  ];
  render();
  expect(textOf('c-1')).toEqual([['123.46 °']]);
  expect(textOf('c-2')).toEqual([['0 °']]);
});

it('draws no value for a degenerate angle, and nothing for hidden, incomplete or other-frame annotations', () => {
  mockAnnotations.Angle = [
    angle('a-degenerate', [[0, 0, 0], [0, 0, 0], [0, 10, 0]]),
    angle('a-hidden', [[10, 0, 0], [0, 0, 0], [0, 10, 0]]),
    angle('a-incomplete', [[10, 0, 0], [0, 0, 0]]),
    angle('a-other', [[10, 0, 0], [0, 0, 0], [0, 10, 0]], { metadata: { toolName: 'Angle', FrameOfReferenceUID: '2.25.9999' } }),
  ];
  mockHidden.add('a-hidden');
  render();

  expect(mockDrawn.filter(d => d.uid === 'a-degenerate').map(d => d.kind)).toEqual(['polyline', 'handles']);
  expect(mockDrawn.filter(d => d.uid !== 'a-degenerate')).toEqual([]);
});

it('draws nothing before the viewport shows its data', () => {
  mockAnnotations.Angle = [angle('a-1', [[10, 0, 0], [0, 0, 0], [0, 10, 0]])];
  mockDrawn.length = 0;
  expect(new AngleDisplay3DTool().renderAnnotation({ viewport: { ...viewport, getActors: () => [] } }, {})).toBe(false);
  expect(mockDrawn).toEqual([]);
});

describe('in a tool group', () => {
  const group = () => {
    const tools = new Set();
    return {
      modes: {},
      hasTool: name => tools.has(name),
      addTool: name => tools.add(name),
      setToolEnabled: jest.fn(function (name) { this.modes[name] = 'Enabled'; }),
      setToolDisabled: jest.fn(function (name) { this.modes[name] = 'Disabled'; }),
      getViewportIds: () => ['volume3d'],
    };
  };

  it('is registered once, added, and shown or hidden', () => {
    const toolGroup = group();
    addAngleDisplay3DToolToGroup(toolGroup);
    expect(mockRegisteredTools.SonadorAngleDisplay3D).toBe(AngleDisplay3DTool);
    expect(toolGroup.modes.SonadorAngleDisplay3D).toBe('Enabled');

    mockRendered.length = 0;
    setAngleDisplay3DEnabled(toolGroup, false);
    expect(toolGroup.modes.SonadorAngleDisplay3D).toBe('Disabled');
    expect(mockRendered).toEqual([['volume3d']]);

    setAngleDisplay3DEnabled(toolGroup, true);
    expect(toolGroup.modes.SonadorAngleDisplay3D).toBe('Enabled');
  });

  it('starts hidden when added hidden, and ignores a group without it', () => {
    const toolGroup = group();
    addAngleDisplay3DToolToGroup(toolGroup, false);
    expect(toolGroup.modes.SonadorAngleDisplay3D).toBe('Disabled');

    const other = group();
    setAngleDisplay3DEnabled(other, true);
    expect(other.setToolEnabled).not.toHaveBeenCalled();
  });
});
