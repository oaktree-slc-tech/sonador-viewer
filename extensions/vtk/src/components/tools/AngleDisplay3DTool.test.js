// The display draws every visible Length, Angle, Cobb angle, circle and Bidirectional annotation of a 3D
// viewport's Frame of Reference, whatever the camera orientation, with its value; it can be shown and hidden.
// Cornerstone3D is stubbed: annotations come from an in-memory store and drawing calls are recorded.

const mockAnnotations = { Length: [], Angle: [], CobbAngle: [], SonadorNonPlanarCobbAngle: [], CircleROI: [], Bidirectional: [] };
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
  mockAnnotations.SonadorNonPlanarCobbAngle = [];
  mockAnnotations.Length = [];
  mockAnnotations.Angle = [];
  mockAnnotations.CobbAngle = [];
  mockAnnotations.CircleROI = [];
  mockAnnotations.Bidirectional = [];
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

it('draws a Length, in-plane or out-of-plane, with its distance in mm', () => {
  const length = (uid, points) => ({
    annotationUID: uid, metadata: { toolName: 'Length', FrameOfReferenceUID: FOR, viewPlaneNormal: [1, 0, 0] },
    data: { handles: { points } },
  });
  mockAnnotations.Length = [length('l-1', [[0, 0, 0], [3, 4, 0]]), length('l-2', [[12, 0, 0], [12, 30, -40]]), length('l-3', [[0, 0, 0]])];

  expect(render()).toBe(true);
  expect(mockDrawn.filter(d => d.uid === 'l-1').map(d => d.kind)).toEqual(['line', 'handles', 'textBox']);
  expect(textOf('l-1')).toEqual([['5 mm']]);
  expect(textOf('l-2')).toEqual([['50 mm']]);
  // An incomplete Length is not drawn
  expect(mockDrawn.filter(d => d.uid === 'l-3')).toEqual([]);
});

it('draws a circle as a closed outline in its plane with its radius, the stored radius while unchanged', () => {
  const values = { radius: 5.25, area: 86.59, perimeter: 32.99 };
  const circle = (uid, points, extra = {}) => ({
    annotationUID: uid, metadata: { toolName: 'CircleROI', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1] },
    data: { handles: { points: points.map(p => p.slice()) }, ...extra },
  });
  mockAnnotations.CircleROI = [
    circle('r-1', [[0, 0, 0], [3, 4, 0]]),
    circle('r-2', [[0, 0, 0], [3, 4, 0]], { recordValue: { values, points: [[0, 0, 0], [3, 4, 0]] } }),
    circle('r-3', [[0, 0, 0], [6, 8, 0]], { recordValue: { values, points: [[0, 0, 0], [3, 4, 0]] } }),
  ];

  expect(render()).toBe(true);
  const outline = mockDrawn.find(d => d.uid === 'r-1' && d.kind === 'polyline');
  expect(outline).toBeDefined();
  expect(mockDrawn.filter(d => d.uid === 'r-1').map(d => d.kind)).toEqual(['polyline', 'handles', 'textBox']);
  expect(textOf('r-1')).toEqual([['Radius: 5 mm']]);
  expect(textOf('r-2')).toEqual([['Radius: 5.25 mm']]);
  expect(textOf('r-3')).toEqual([['Radius: 10 mm']]);
});

it('draws a Bidirectional as its two axes with L x W mm, the stored length of an unchanged axis, and follows its visibility', () => {
  const points = [[0, 0, 0], [20, 0, 0], [10, -6, 0], [10, 6, 0]];
  const bidirectional = {
    annotationUID: 'b-1', metadata: { toolName: 'Bidirectional', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1] },
    data: { handles: { points }, recordValue: { values: { length: 20.04, width: 11.98 }, points: points.map(point => point.slice()) } },
  };
  mockAnnotations.Bidirectional = [bidirectional];
  expect(render()).toBe(true);
  const lines = mockDrawn.filter(d => d.kind === 'line' && d.uid === 'b-1');
  expect(lines.map(d => d.partUID)).toEqual(['line1', 'line2']);
  expect(lines.map(d => d.args.slice(0, 2))).toEqual([[[0, 0], [20, 0]], [[10, -6], [10, 6]]]);
  expect(textOf('b-1')).toEqual([['20.04 x 11.98 mm']]);

  // A moved long-axis handle: its length measured, the width kept
  bidirectional.data.handles.points = [[0, 0, 0], [30, 0, 0], [10, -6, 0], [10, 6, 0]];
  render();
  expect(textOf('b-1')).toEqual([['30.00 x 11.98 mm']]);

  mockHidden.add('b-1');
  render();
  expect(mockDrawn.filter(d => d.uid === 'b-1')).toEqual([]);
});

it('shows each axis of a Bidirectional in its stored unit', () => {
  const points = [[0, 0, 0], [20, 0, 0], [10, -6, 0], [10, 6, 0]];
  mockAnnotations.Bidirectional = [{
    annotationUID: 'b-2', metadata: { toolName: 'Bidirectional', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1] },
    data: { handles: { points }, recordValue: { values: { length: 20, width: 1.2, unit: 'mm', widthUnit: 'cm' }, points: points.map(p => p.slice()) } },
  }];
  render();
  expect(textOf('b-2')).toEqual([['20.00 mm x 1.20 cm']]);
});

it('draws a circle whose plane is not known as its radius line, without an outline', () => {
  mockAnnotations.CircleROI = [{
    annotationUID: 'r-legacy', metadata: { toolName: 'CircleROI', FrameOfReferenceUID: FOR, viewPlaneNormal: [0, 0, 1], planeUnknown: true },
    data: { handles: { points: [[0, 0, 0], [3, 4, 0]] } },
  }];
  render();
  expect(mockDrawn.filter(d => d.uid === 'r-legacy').map(d => d.kind)).toEqual(['line', 'handles', 'textBox']);
  expect(textOf('r-legacy')).toEqual([['Radius: 5 mm']]);
});

it("shows a Length's record value while its points are unchanged, and the new distance after an edit", () => {
  const points = [[0, 0, 0], [30, 40, 0]];
  const stored = () => ({
    annotationUID: 'l-stored', metadata: { toolName: 'Length', FrameOfReferenceUID: FOR, viewPlaneNormal: [1, 0, 0] },
    data: { handles: { points: points.map(p => p.slice()) }, recordValue: { value: 49.876, points } },
  });
  mockAnnotations.Length = [stored()];
  render();
  expect(textOf('l-stored')).toEqual([['49.88 mm']]);

  const edited = stored();
  edited.data.handles.points[1] = [60, 80, 0];
  mockAnnotations.Length = [edited];
  render();
  expect(textOf('l-stored')).toEqual([['100 mm']]);
});

it('draws a Cobb angle whose lines lie in no common plane as its two lines, with its stored value', () => {
  const skew = [[0, 0, 0], [10, 0, 0], [0, 10, 10], [0, 20, 10]];
  mockAnnotations.SonadorNonPlanarCobbAngle = [{
    annotationUID: 's-1', metadata: { toolName: 'SonadorNonPlanarCobbAngle', FrameOfReferenceUID: FOR },
    data: { handles: { points: skew.map(p => p.slice()) }, recordValue: { value: 90, points: skew } },
  }];
  expect(render()).toBe(true);
  expect(mockDrawn.filter(d => d.uid === 's-1').map(d => d.kind)).toEqual(['line', 'line', 'handles', 'textBox']);
  expect(textOf('s-1')).toEqual([['90 °']]);
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
