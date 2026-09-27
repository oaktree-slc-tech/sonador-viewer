// M3DModelView.setCameraOrientation: preset view directions with the models fitted to the view

import { BoxGeometry, Group, Mesh, OrthographicCamera, PerspectiveCamera } from 'three';

import M3DModelView from './M3DModelView';

// @ohif/core pulls in the whole viewer runtime; the view only needs these names at import
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: { classes: {} },
  MODULE_TYPES: {},
  utils: {},
  redux: {},
}));

// camera-controls allocates a DOMRect at construction
if (typeof global.DOMRect === 'undefined') {
  global.DOMRect = class DOMRect {};
}

function createView({ camera = new OrthographicCamera(-100, 100, 50, -50, 0.1, 1000), model } = {}) {
  const view = new M3DModelView({ ...M3DModelView.defaultProps, models: [] });
  view.camera = camera;
  view.controls = {};
  view.model = model;
  view.setCameraLookAt = jest.fn();
  return view;
}

// A 20 x 40 x 60 box centred on the origin (bounding-sphere radius ~37.4)
function createModel() {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(20, 40, 60)));
  return group;
}

describe('M3DModelView.setCameraOrientation', () => {
  it('looks from the front with superior up and fits the box height (orthographic)', () => {
    const view = createView({ model: createModel() });

    expect(view.setCameraOrientation({ viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1] })).toBe(true);

    const [camera] = view.setCameraLookAt.mock.calls[0];
    expect(camera.target.map(v => +v.toFixed(6))).toEqual([0, 0, 0]);
    expect(camera.up).toEqual([0, 0, 1]);
    expect(camera.position[0]).toBeCloseTo(0);
    expect(camera.position[1]).toBeLessThan(0);           // anterior side
    expect(camera.position[2]).toBeCloseTo(0);
    // 60 tall, 20 wide at aspect 2: the height rules; half of it with the 10 % margin
    expect(camera.parallelScale).toBeCloseTo(33);
  });

  it('fits the width when it dominates at the view aspect', () => {
    const view = createView({
      camera: new OrthographicCamera(-50, 50, 50, -50, 0.1, 1000), // aspect 1
      model: createModel(),
    });

    // From above: 40 across (y) by 20 tall (x on screen) -> the 40 rules
    view.setCameraOrientation({ viewPlaneNormal: [0, 0, 1], viewUp: [1, 0, 0] });

    const [camera] = view.setCameraLookAt.mock.calls[0];
    expect(camera.parallelScale).toBeCloseTo(22);
    expect(camera.position[2]).toBeGreaterThan(0);
  });

  it('places a perspective camera far enough to see the fitted height', () => {
    const view = createView({ camera: new PerspectiveCamera(90, 2, 0.1, 1000), model: createModel() });

    view.setCameraOrientation({ viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1] });

    const [camera] = view.setCameraLookAt.mock.calls[0];
    // halfHeight 33 at a 90 degree fov -> 33 away from the centre, plus the bounding radius
    expect(-camera.position[1]).toBeCloseTo(33 + Math.hypot(20, 40, 60) / 2, 3);
  });

  it('returns false with nothing to frame or a degenerate direction', () => {
    const empty = createView();
    expect(empty.setCameraOrientation({ viewPlaneNormal: [0, 0, 1], viewUp: [0, 1, 0] })).toBe(false);

    const view = createView({ model: createModel() });
    expect(view.setCameraOrientation({ viewPlaneNormal: [0, 0, 1], viewUp: [0, 0, 1] })).toBe(false);
    expect(view.setCameraLookAt).not.toHaveBeenCalled();
  });
});
