// Rebinding M3DModelView's camera mouse buttons (e.g. for an editing tool that needs the left
// button), against the real camera-controls

import * as THREE from 'three';
import CameraControls from 'camera-controls';

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

const { ACTION } = CameraControls;

function createView() {
  const view = new M3DModelView({ ...M3DModelView.defaultProps, models: [] });
  view.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  view.controls = new CameraControls(view.camera);
  return view;
}

describe('M3DModelView.setMouseActions', () => {
  it('rebinds the named buttons and leaves the others', () => {
    const view = createView();
    const { middle } = view.controls.mouseButtons;

    view.setMouseActions({ left: 'none', right: 'rotate', wheel: 'zoom' });

    expect(view.controls.mouseButtons).toMatchObject({
      left: ACTION.NONE, right: ACTION.ROTATE, wheel: ACTION.ZOOM, middle,
    });
  });

  it('restores the bindings the view started with', () => {
    const view = createView();
    const initial = { ...view.controls.mouseButtons };

    view.setMouseActions({ left: 'none', right: 'rotate', middle: 'pan' });
    view.setMouseActions({ left: 'dolly' });
    view.setMouseActions(null);

    expect(view.controls.mouseButtons).toEqual(initial);
  });

  it('ignores unknown action names, and calls before the controls exist', () => {
    const view = createView();
    const { left } = view.controls.mouseButtons;

    view.setMouseActions({ left: 'spin' });
    expect(view.controls.mouseButtons.left).toBe(left);

    view.controls = undefined;
    expect(() => view.setMouseActions({ left: 'none' })).not.toThrow();
  });
});

describe('M3DModelView trackball rotation bindings', () => {
  function createTrackballView() {
    const view = new M3DModelView({ ...M3DModelView.defaultProps, models: [], rotation: 'trackball' });
    view.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    view.camera.position.set(0, 0, 50);
    // Enough of a DOM element for camera-controls' connect() and the trackball's listeners
    const domElement = {
      addEventListener: jest.fn(), removeEventListener: jest.fn(), setAttribute: jest.fn(),
      style: {}, clientWidth: 100, clientHeight: 100,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      ownerDocument: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
    };
    view.controls = view.initControls({ domElement }, view.camera, null);
    return view;
  }

  it('takes the left button away from the orbit and gives it to the trackball', () => {
    const view = createTrackballView();
    expect(view.controls.mouseButtons.left).toBe(ACTION.NONE);
    expect(view._rotateButton).toBe('left');
    expect(view._trackball.getButton()).toBe(0);
  });

  it('follows a rebinding of the rotate button, and a restore', () => {
    const view = createTrackballView();

    view.setMouseActions({ left: 'none', right: 'rotate', middle: 'pan', wheel: 'zoom' });
    expect(view.controls.mouseButtons).toMatchObject({ left: ACTION.NONE, right: ACTION.NONE, middle: ACTION.TRUCK });
    expect(view._trackball.getButton()).toBe(2);

    view.setMouseActions({ right: 'pan' });
    expect(view.controls.mouseButtons.right).toBe(ACTION.TRUCK);
    expect(view._trackball.getButton()).toBe(-1);

    view.setMouseActions(null);
    expect(view.controls.mouseButtons.left).toBe(ACTION.NONE);
    expect(view._trackball.getButton()).toBe(0);
  });

  it('turns the camera through camera-controls, preserving roll', () => {
    const view = createTrackballView();
    view.controls.setLookAt(0, 0, 50, 0, 0, 0, false);
    view.controls.update(0);

    view._applyTrackballRotation([0.5, 0.5], [0.5, 0.4]);   // tilt about the right axis
    const position = view.controls.getPosition(new THREE.Vector3());
    expect(position.length()).toBeCloseTo(50);
    expect(position.z).toBeCloseTo(50 * Math.cos(0.2));
    expect(view.camera.up.z).not.toBeCloseTo(0);

    view._applyTrackballRotation([0.5, 0.5], [0.6, 0.5]);   // turn about the (tilted) up axis
    const turned = view.controls.getPosition(new THREE.Vector3());
    expect(turned.length()).toBeCloseTo(50);
    expect(Math.abs(turned.dot(view.camera.up))).toBeLessThan(1e-6);
  });
});
