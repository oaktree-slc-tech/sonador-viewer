// The DICOMSRDisplay tool draws the read-only SR annotations of a viewport's Frame of Reference: all
// of them in a 3D view, only those in the displayed slice in a slice view. Cornerstone3D is stubbed:
// the annotations come from an in-memory store and the SVG drawing calls are recorded.

const mockAnnotations = [];
const mockDrawn = [];
const mockRegisteredTools = {};

jest.mock('@cornerstonejs/core', () => {
  class VolumeViewport {}
  class StackViewport {}
  return {
    Enums: { ViewportType: { VOLUME_3D: 'volume3d', ORTHOGRAPHIC: 'orthographic' } },
    VolumeViewport,
    StackViewport,
    metaData: { get: () => undefined },
    utilities: { getTargetVolumeAndSpacingInNormalDir: () => ({ spacingInNormalDirection: 1 }) },
    getRenderingEngines: () => [],
  };
}, { virtual: true });

jest.mock('@cornerstonejs/tools', () => {
  class AnnotationTool {
    constructor(toolProps, defaultToolProps) {
      this.configuration = { ...defaultToolProps.configuration, ...(toolProps.configuration || {}) };
      this.toolGroupId = 'group';
    }
    getToolName() {
      return this.constructor.toolName;
    }
    getStyle(property) {
      return property === 'colorSelected' ? 'rgb(0, 220, 0)' : property === 'color' ? 'rgb(255, 255, 0)' : 1;
    }
    getLinkedTextBoxStyle() {
      return {};
    }
  }
  const record = kind => (helper, uid, partUID, ...args) => mockDrawn.push({ kind, uid, partUID, args });
  return {
    AnnotationTool,
    addTool: ToolClass => { mockRegisteredTools[ToolClass.toolName] = ToolClass; },
    state: { get tools() { return mockRegisteredTools; } },
    annotation: { state: { getAnnotations: () => mockAnnotations } },
    drawing: {
      drawArrow: record('arrow'),
      drawHandles: record('handles'),
      drawLine: record('line'),
      drawPolyline: record('polyline'),
      drawLinkedTextBox: record('textBox'),
    },
    utilities: { drawing: { getTextBoxCoordsCanvas: points => points[0] } },
  };
}, { virtual: true });

jest.mock('@ohif/core/src/log', () => ({
  __esModule: true, default: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
}));

import { StackViewport, VolumeViewport } from '@cornerstonejs/core';
import DICOMSRDisplayTool, { addSRDisplayToolToGroup } from './DICOMSRDisplayTool';

// A Length along x at y = 5, z = 40, and a point without a second point
const lengthAnnotation = {
  annotationUID: 'DICOMSRDisplay:2.25.1',
  isVisible: true,
  metadata: { toolName: 'DICOMSRDisplay', FrameOfReferenceUID: '2.25.9' },
  data: {
    TrackingUniqueIdentifier: '2.25.1',
    labels: [{ label: 'Length', value: '20.00 mm' }, { label: 'Finding site', value: 'Femur' }],
    renderableData: [{ shape: 'polyline', points: [[0, 5, 40], [20, 5, 40]] }],
    srPlane: { point: [0, 5, 40], inPlaneVectors: [[1, 0, 0]] },
  },
};
const pointAnnotation = {
  annotationUID: 'DICOMSRDisplay:2.25.2',
  isVisible: true,
  metadata: { toolName: 'DICOMSRDisplay', FrameOfReferenceUID: '2.25.9' },
  data: {
    TrackingUniqueIdentifier: '2.25.2',
    labels: [],
    renderableData: [{ shape: 'point', points: [[100, 100, 0]] }],
    srPlane: { point: [100, 100, 0], inPlaneVectors: [] },
  },
};

const viewportOf = (Type, type, camera) => Object.assign(new Type(), {
  id: 'viewport', type, element: {},
  getActors: () => [{}],
  getCamera: () => camera,
  worldToCanvas: point => [point[0], point[1]],
});

const render = viewport => new DICOMSRDisplayTool().renderAnnotation({ viewport }, {});

beforeEach(() => {
  mockAnnotations.length = 0;
  mockDrawn.length = 0;
});


describe('DICOMSRDisplayTool', () => {
  it('draws every annotation of the Frame of Reference in a 3D view, dashed, with its labels', () => {
    mockAnnotations.push(lengthAnnotation);
    expect(render(viewportOf(VolumeViewport, 'volume3d', {}))).toBe(true);

    const line = mockDrawn.find(item => item.kind === 'line');
    expect(line.args.slice(0, 2)).toEqual([[0, 5], [20, 5]]);
    expect(line.args[2]).toMatchObject({ color: 'rgb(255, 255, 0)', lineDash: '4,4' });
    expect(mockDrawn.find(item => item.kind === 'textBox').args[0]).toEqual(['20.00 mm', 'Finding site: Femur']);
  });

  it('draws in a slice view only what lies in the displayed slice', () => {
    mockAnnotations.push(lengthAnnotation);

    expect(render(viewportOf(VolumeViewport, 'orthographic', { viewPlaneNormal: [0, 1, 0], focalPoint: [0, 5, 0] }))).toBe(true);
    mockDrawn.length = 0;
    expect(render(viewportOf(VolumeViewport, 'orthographic', { viewPlaneNormal: [1, 0, 0], focalPoint: [10, 0, 0] }))).toBe(false);
    expect(render(viewportOf(StackViewport, 'stack', { viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 42] }))).toBe(false);
    expect(mockDrawn).toEqual([]);
  });

  it('draws nothing over a viewport without data', () => {
    mockAnnotations.push(lengthAnnotation);
    const viewport = viewportOf(VolumeViewport, 'volume3d', {});
    viewport.getActors = () => [];
    expect(render(viewport)).toBe(false);
  });

  it('points an arrow at a single point from a canvas offset, needing no image', () => {
    mockAnnotations.push(pointAnnotation);
    render(viewportOf(VolumeViewport, 'volume3d', {}));

    const arrow = mockDrawn.find(item => item.kind === 'arrow');
    expect(arrow.args.slice(0, 2)).toEqual([[60, 60], [100, 100]]);
  });

  it('registers once and is enabled in a tool group, never active', () => {
    const toolGroup = { tools: new Set(), hasTool: name => toolGroup.tools.has(name), addTool: jest.fn(name => toolGroup.tools.add(name)), setToolEnabled: jest.fn() };

    addSRDisplayToolToGroup(toolGroup);
    addSRDisplayToolToGroup(toolGroup);

    expect(mockRegisteredTools.DICOMSRDisplay).toBe(DICOMSRDisplayTool);
    expect(toolGroup.addTool).toHaveBeenCalledTimes(1);
    expect(toolGroup.setToolEnabled).toHaveBeenCalledWith('DICOMSRDisplay');
  });
});
