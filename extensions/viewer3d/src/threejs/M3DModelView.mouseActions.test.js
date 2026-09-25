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
