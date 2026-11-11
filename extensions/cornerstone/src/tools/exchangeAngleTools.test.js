// The Cornerstone3D Angle and Cobb angle tools show the exchange value: endpoint order kept, and a
// mirrored record's value while the points are unchanged.

const mockAddTool = jest.fn();
// Annotations by tool name, and annotation UIDs hidden
const mockAnnotations = {};
const mockHidden = new Set();
// The unit the stock Length tool measures in (`mm` on a calibrated image, `px` otherwise)
let mockLengthUnit = 'mm';
jest.mock('@cornerstonejs/tools', () => {
  // As the published 4.22.13 tools: the renderer is an instance property and draws a label only
  // for a truthy cached angle
  class StockTool {
    constructor() {
      this.configuration = { getTextLines: (data, targetId) => [`${data.cachedStats[targetId].angle} \u00B0`] };
      this.labels = [];
      this.renderAnnotation = (enabledElement) => {
        const targetId = this.getTargetId(enabledElement.viewport);
        (mockAnnotations[this.getToolName()] || []).forEach(annotation => {
          if (!annotation.data.cachedStats[targetId]) {
            annotation.data.cachedStats[targetId] = { angle: null };
            this._calculateCachedStats(annotation);
          }
          if (mockHidden.has(annotation.annotationUID) || !annotation.data.cachedStats[targetId]?.angle) {
            return;
          }
          this.renderLinkedTextBoxAnnotation({ annotation, textLines: this.configuration.getTextLines(annotation.data, targetId) });
        });
        return true;
      };
    }
    getToolName() { return this.constructor.toolName; }
    getTargetId() { return 'imageId:a'; }
    filterInteractableAnnotationsForElement(element, annotations) { return annotations; }
    renderLinkedTextBoxAnnotation(options) { this.labels.push(options); return true; }
  }
  // As the published 4.22.13 CobbAngleTool: endpoints reordered by proximity before the angle
  const angleBetweenLines = ([p1, p2], [p3, p4]) => {
    const v1 = p2.map((v, i) => v - p1[i]);
    const v2 = p3.map((v, i) => v - p4[i]);
    const dot = v1.reduce((sum, v, i) => sum + v * v2[i], 0);
    const norm = v => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    return Math.acos(dot / (norm(v1) * norm(v2))) * 180 / Math.PI;
  };
  const distance = (a, b) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));
  class CobbAngleTool extends StockTool {
    _calculateCachedStats(annotation) {
      const points = annotation.data.handles.points;
      const seg1 = [null, null];
      const seg2 = [null, null];
      let minDist = Number.MAX_VALUE;
      for (let i = 0; i < 2; i += 1) {
        for (let j = 2; j < 4; j += 1) {
          const dist = distance(points[i], points[j]);
          if (dist < minDist) {
            minDist = dist;
            seg1[1] = points[i];
            seg1[0] = points[(i + 1) % 2];
            seg2[0] = points[j];
            seg2[1] = points[2 + ((j - 1) % 2)];
          }
        }
      }
      Object.keys(annotation.data.cachedStats).forEach(id => {
        annotation.data.cachedStats[id] = { angle: angleBetweenLines(seg1, seg2), arc1Angle: 1 };
      });
      return annotation.data.cachedStats;
    }
  }
  CobbAngleTool.toolName = 'CobbAngle';
  class AngleTool extends StockTool {
    _calculateCachedStats(annotation) {
      const [p1, p2, p3] = annotation.data.handles.points;
      Object.keys(annotation.data.cachedStats).forEach(id => {
        annotation.data.cachedStats[id] = { angle: angleBetweenLines([p1, p2], [p2, p3]) };
      });
      return annotation.data.cachedStats;
    }
  }
  AngleTool.toolName = 'Angle';
  // As the published 4.22.13 LengthTool: the calibrated length of the points, read by the default
  // text lines (`${roundNumber(length)} ${unit}`, roundNumber giving two decimals here)
  class LengthTool extends StockTool {
    constructor() {
      super();
      this.configuration = { getTextLines: (data, targetId) => {
        const { length, unit } = data.cachedStats[targetId];
        return length === undefined || length === null || isNaN(length) ? undefined : [`${length.toFixed(2)} ${unit}`];
      } };
    }
    _calculateCachedStats(annotation) {
      const [a, b] = annotation.data.handles.points;
      const length = distance(a, b);
      Object.keys(annotation.data.cachedStats).forEach(id => {
        const unit = mockLengthUnit;
        annotation.data.cachedStats[id] = { length, unit, statsArray: [{ name: 'length', value: length, unit, type: 'Linear' }] };
      });
      return annotation.data.cachedStats;
    }
  }
  LengthTool.toolName = 'Length';
  return {
    AngleTool,
    CobbAngleTool,
    LengthTool,
    addTool: (...args) => mockAddTool(...args),
    annotation: {
      state: { getAnnotations: toolName => mockAnnotations[toolName] || [] },
      visibility: { isAnnotationVisible: uid => !mockHidden.has(uid) },
    },
  };
}, { virtual: true });
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { DICOMSR: { angleGeometry: jest.requireActual('../../../../platform/core/src/DICOMSR/utils/angleGeometry') } },
}), { virtual: true });

import { ExchangeAngleTool, ExchangeCobbAngleTool, ExchangeLengthTool, registerExchangeAngleTools } from './exchangeAngleTools';
import { CobbAngleTool } from '@cornerstonejs/tools';

const annotationOf = (points, recordValue) => ({ data: { handles: { points }, cachedStats: { 'imageId:a': {} }, recordValue } });
const statsOf = (Tool, annotation) => {
  new Tool()._calculateCachedStats(annotation);
  return annotation.data.cachedStats['imageId:a'];
};

const WORKED_EXAMPLE = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]];
const REVERSED = [[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 10, 0]];

it('the stock calculator reorders the endpoints of the worked example (the difference the tools remove)', () => {
  expect(statsOf(CobbAngleTool, annotationOf(WORKED_EXAMPLE)).angle).toBeCloseTo(45, 6);
});

it('shows 135 degrees for the worked example and 45 for its reversed second line', () => {
  expect(statsOf(ExchangeCobbAngleTool, annotationOf(WORKED_EXAMPLE)).angle).toBeCloseTo(135, 6);
  expect(statsOf(ExchangeCobbAngleTool, annotationOf(REVERSED)).angle).toBeCloseTo(45, 6);
});

it('keeps the rest of the stock statistics', () => {
  expect(statsOf(ExchangeCobbAngleTool, annotationOf(WORKED_EXAMPLE)).arc1Angle).toBe(1);
});

it('shows a mirrored record value, deliberately different from the geometry, while the points are unchanged', () => {
  const annotation = annotationOf(WORKED_EXAMPLE.map(point => point.slice()), { value: 123.456, points: WORKED_EXAMPLE });
  expect(statsOf(ExchangeCobbAngleTool, annotation).angle).toBe(123.456);

  annotation.data.handles.points[3] = [0, 20, 0];
  expect(statsOf(ExchangeCobbAngleTool, annotation).angle).toBeCloseTo(90, 6);
});

it('does the same for Angle', () => {
  const points = [[10, 0, 0], [0, 0, 0], [0, 10, 0]];
  expect(statsOf(ExchangeAngleTool, annotationOf(points)).angle).toBeCloseTo(90, 6);
  expect(statsOf(ExchangeAngleTool, annotationOf(points, { value: 89.5, points })).angle).toBe(89.5);
});

describe('Length', () => {
  // Endpoints 50 mm apart; a record stored with 49.876 mm
  const POINTS = [[0, 0, 0], [30, 40, 0]];
  const labelOf = annotation => new ExchangeLengthTool().configuration.getTextLines(annotation.data, 'imageId:a');
  afterEach(() => { mockLengthUnit = 'mm'; });

  it('shows the stored length while the points are unchanged, in the statistics and the label', () => {
    const annotation = annotationOf(POINTS.map(point => point.slice()), { value: 49.876, points: POINTS });
    const stats = statsOf(ExchangeLengthTool, annotation);
    expect(stats).toMatchObject({ length: 49.876, unit: 'mm' });
    expect(stats.statsArray).toEqual([{ name: 'length', value: 49.876, unit: 'mm', type: 'Linear' }]);
    expect(labelOf(annotation)).toEqual(['49.88 mm']);
  });

  it('shows the measured length after an edit, for a new drawing, and on an uncalibrated image', () => {
    const edited = annotationOf(POINTS.map(point => point.slice()), { value: 49.876, points: POINTS });
    edited.data.handles.points[1] = [60, 80, 0];
    expect(statsOf(ExchangeLengthTool, edited).length).toBeCloseTo(100, 6);
    expect(labelOf(edited)).toEqual(['100.00 mm']);

    const drawn = annotationOf(POINTS.map(point => point.slice()));
    expect(statsOf(ExchangeLengthTool, drawn).length).toBeCloseTo(50, 6);

    mockLengthUnit = 'px';
    const uncalibrated = annotationOf(POINTS.map(point => point.slice()), { value: 49.876, points: POINTS });
    expect(statsOf(ExchangeLengthTool, uncalibrated)).toMatchObject({ length: 50, unit: 'px' });
  });
});

it('registers under the stock tool names', () => {
  registerExchangeAngleTools();
  expect(mockAddTool.mock.calls.map(([Tool]) => Tool.toolName)).toEqual(['Angle', 'CobbAngle', 'Length']);
});



describe('labels in the inspection view', () => {
  const viewport = { id: 'inspection', element: {}, worldToCanvas: point => point.slice(0, 2) };
  const renderWith = (Tool, toolName, annotations) => {
    mockAnnotations[toolName] = annotations;
    const tool = new Tool();
    tool.renderAnnotation({ viewport }, {});
    return tool.labels;
  };
  const shown = (points, uid = 'a-1') => ({ annotationUID: uid, data: { handles: { points }, cachedStats: {} } });
  afterEach(() => {
    Object.keys(mockAnnotations).forEach(key => delete mockAnnotations[key]);
    mockHidden.clear();
  });

  it('the stock renderer leaves a 0-degree angle unlabelled (the case the tools cover)', () => {
    expect(renderWith(CobbAngleTool, 'CobbAngle', [shown([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]])])).toEqual([]);
  });

  it('labels a valid 0-degree Cobb angle once, with the Cobb angle text box', () => {
    const labels = renderWith(ExchangeCobbAngleTool, 'CobbAngle', [shown([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]])]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ textBoxUID: 'cobbAngleText', textLines: ['0 \u00B0'] });
  });

  it('labels a valid 0-degree Angle once, anchored at the vertex', () => {
    const labels = renderWith(ExchangeAngleTool, 'Angle', [shown([[10, 0, 0], [0, 0, 0], [10, 0, 0]])]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ textLines: ['0 \u00B0'], placementPoints: [[0, 0], [0, 0]] });
  });

  it('labels an imported 0-degree value while its points are unchanged', () => {
    const points = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]];
    const annotation = shown(points.map(point => point.slice()));
    annotation.data.recordValue = { value: 0, points };
    expect(renderWith(ExchangeCobbAngleTool, 'CobbAngle', [annotation]).map(label => label.textLines)).toEqual([['0 \u00B0']]);
  });

  it('leaves non-zero labels to the stock renderer, and draws none for an absent value or a hidden annotation', () => {
    const nonZero = shown([[0, 0, 0], [10, 0, 0], [0, 10, 0], [10, 20, 0]], 'a-1');
    const degenerate = shown([[0, 0, 0], [0, 0, 0], [0, 10, 0], [10, 20, 0]], 'a-2');
    const hidden = shown([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], 'a-3');
    mockHidden.add('a-3');
    const labels = renderWith(ExchangeCobbAngleTool, 'CobbAngle', [nonZero, degenerate, hidden]);

    expect(labels).toHaveLength(1);
    expect(labels[0].annotation).toBe(nonZero);
    expect(degenerate.data.cachedStats['imageId:a'].angle).toBeNull();
  });
});
