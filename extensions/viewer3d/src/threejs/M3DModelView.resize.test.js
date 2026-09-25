// M3DModelView following its container's size (the Segmentation Editor's 3D tab can be resized
// by flexlayout without any window or sidebar event)

import { OrthographicCamera, PerspectiveCamera } from 'three';

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

let observers;
let frames;

beforeEach(() => {
  observers = [];
  frames = [];
  global.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.observe = jest.fn();
      this.disconnect = jest.fn();
      observers.push(this);
    }
  };
  global.window = {
    devicePixelRatio: 1,
    requestAnimationFrame: callback => frames.push(callback),
    cancelAnimationFrame: jest.fn(),
  };
});

afterEach(() => {
  delete global.ResizeObserver;
  delete global.window;
});

const runFrames = () => frames.splice(0).forEach(callback => callback());

function createView({ camera = new OrthographicCamera(-100, 100, 50, -50, 0.1, 1000), width = 400, height = 200 } = {}) {
  const view = new M3DModelView({ ...M3DModelView.defaultProps, observeResize: true, models: [] });
  view.container = { current: { clientWidth: width, clientHeight: height } };
  view.camera = camera;
  view.renderer = {
    setSize: jest.fn(), setPixelRatio: jest.fn(), render: jest.fn(),
    dispose: jest.fn(), forceContextLoss: jest.fn(),
  };
  view.scene = {};
  return view;
}

describe('M3DModelView resize', () => {
  it('keeps an orthographic view\'s height and fits its width to the new aspect', () => {
    const view = createView({ width: 300, height: 100 });

    expect(view.resize()).toBe(true);

    expect(view.camera.top).toBe(50);
    expect(view.camera.bottom).toBe(-50);
    expect(view.camera.right).toBe(150);
    expect(view.camera.left).toBe(-150);
    expect(view.renderer.setSize).toHaveBeenCalledWith(300, 100);
  });

  it('updates a perspective view\'s aspect', () => {
    const view = createView({ camera: new PerspectiveCamera(30, 1, 0.1, 100), width: 300, height: 100 });

    view.resize();

    expect(view.camera.aspect).toBe(3);
  });

  it('ignores a hidden (0 x 0) container', () => {
    const view = createView({ width: 0, height: 0 });

    expect(view.resize()).toBe(false);

    expect(view.camera.right).toBe(100);
    expect(view.renderer.setSize).not.toHaveBeenCalled();
  });

  it('resizes and redraws when the container changes size, once per frame', () => {
    const view = createView();
    view.observeContainerResize();
    const [observer] = observers;
    expect(observer.observe).toHaveBeenCalledWith(view.container.current);

    view.container.current.clientWidth = 600;
    observer.callback();
    observer.callback();
    expect(frames).toHaveLength(1);

    runFrames();
    expect(view.renderer.setSize).toHaveBeenCalledWith(600, 200);
    expect(view.renderer.render).toHaveBeenCalledTimes(1);

    // Same size again (e.g. an observer notification for an unrelated reason): nothing to do
    observer.callback();
    runFrames();
    expect(view.renderer.setSize).toHaveBeenCalledTimes(1);
  });

  it('does not size to a hidden container, and catches up when it is shown', () => {
    const view = createView();
    view.observeContainerResize();
    const [observer] = observers;

    Object.assign(view.container.current, { clientWidth: 0, clientHeight: 0 });
    observer.callback();
    runFrames();
    expect(view.renderer.setSize).not.toHaveBeenCalled();

    Object.assign(view.container.current, { clientWidth: 500, clientHeight: 250 });
    observer.callback();
    runFrames();
    expect(view.renderer.setSize).toHaveBeenCalledWith(500, 250);
  });

  it('stops observing on unmount', () => {
    const view = createView();
    view.observeContainerResize();
    const [observer] = observers;
    observer.callback();

    view.componentWillUnmount();

    expect(observer.disconnect).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});
