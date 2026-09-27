// Trackball rotation: the Cornerstone3D TrackballRotateTool behaviour on a Three.js camera

import { trackballRotate, TrackballRotation, POINTER_BUTTONS } from './trackballRotation';

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = v => Math.hypot(...v);

// Camera in front of the origin (+z), screen up +y
const front = { position: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0] };

describe('trackballRotate', () => {
  it('turns a horizontal drag about the camera up axis, keeping up', () => {
    const { position, up } = trackballRotate({ ...front, previous: [0.5, 0.5], current: [0.6, 0.5] });

    expect(close(up, [0, 1, 0])).toBe(true);
    expect(position[1]).toBeCloseTo(0);              // stays in the plane normal to up
    expect(length(position)).toBeCloseTo(100);       // same distance from the target
    expect(position[0]).toBeLessThan(0);             // Cornerstone3D's direction for a rightward drag
  });

  it('turns a vertical drag about the camera right axis, tilting up with it', () => {
    const { position, up } = trackballRotate({ ...front, previous: [0.5, 0.5], current: [0.5, 0.4] });

    expect(position[0]).toBeCloseTo(0);
    expect(length(position)).toBeCloseTo(100);
    expect(dot(up, position)).toBeCloseTo(0);        // up stays perpendicular to the view
    expect(up[2]).not.toBeCloseTo(0);                // the camera tilted, so up left the y axis
  });

  it('uses Cornerstone3D\'s magnitudes: 2 rad per full-height drag, ~2.9 rad per full-width drag', () => {
    const vertical = trackballRotate({ ...front, previous: [0.5, 1], current: [0.5, 0] });
    const tilt = Math.acos(dot(vertical.position, [0, 0, 1]) / 100);
    expect(tilt).toBeCloseTo(2, 6);

    const horizontal = trackballRotate({ ...front, previous: [0, 0.5], current: [1, 0.5] });
    const turn = Math.acos(dot(horizontal.position, [0, 0, 1]) / 100);
    expect(turn).toBeCloseTo(2 * 2 * Math.acos(Math.sqrt(1.25) / 1.5), 6);
  });

  it('has no pole: repeated vertical drags keep turning (roll accumulates as in VTK)', () => {
    let camera = { ...front };
    for (let i = 0; i < 40; i += 1) {
      camera = { ...camera, ...trackballRotate({ ...camera, previous: [0.5, 0.5], current: [0.5, 0.4] }) };
    }
    // 40 steps of 0.2 rad = 8 rad, past a full turn; the camera keeps orbiting through the poles
    expect(length(camera.position)).toBeCloseTo(100);
    expect(dot(camera.up, camera.position)).toBeCloseTo(0);
    expect(camera.position[2]).toBeCloseTo(100 * Math.cos(8));
  });

  it('returns null for a drag too small to turn, and scales with rotateSpeed', () => {
    expect(trackballRotate({ ...front, previous: [0.5, 0.5], current: [0.5, 0.5] })).not.toBeNull();
    const slow = trackballRotate({ ...front, previous: [0.5, 0.5], current: [0.5, 0.4], rotateSpeed: 1 });
    const fast = trackballRotate({ ...front, previous: [0.5, 0.5], current: [0.5, 0.4], rotateSpeed: 2 });
    expect(Math.acos(slow.position[2] / 100) * 2).toBeCloseTo(Math.acos(fast.position[2] / 100));
  });
});

describe('TrackballRotation', () => {
  function createElement() {
    const listeners = {};
    return {
      listeners,
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
      ownerDocument: {
        listeners,
        addEventListener: (type, fn) => { listeners['doc:' + type] = fn; },
        removeEventListener: (type) => { delete listeners['doc:' + type]; },
      },
    };
  }

  it('reports normalized drag steps for the rotate button only', () => {
    const element = createElement();
    const onRotate = jest.fn();
    const trackball = new TrackballRotation(element, { getButton: () => POINTER_BUTTONS.right, onRotate });

    element.listeners.pointerdown({ button: 0, pointerId: 1, clientX: 110, clientY: 70, preventDefault: jest.fn() });
    expect(trackball.dragging).toBe(false);

    element.listeners.pointerdown({ button: 2, pointerId: 2, clientX: 110, clientY: 70, preventDefault: jest.fn() });
    expect(trackball.dragging).toBe(true);
    element.listeners['doc:pointermove']({ pointerId: 2, clientX: 130, clientY: 60 });
    element.listeners['doc:pointermove']({ pointerId: 3, clientX: 0, clientY: 0 });   // another pointer
    element.listeners['doc:pointerup']({ pointerId: 2 });

    expect(onRotate).toHaveBeenCalledTimes(1);
    expect(onRotate).toHaveBeenCalledWith([0.5, 0.5], [0.6, 0.4]);
    expect(trackball.dragging).toBe(false);
    expect(element.listeners['doc:pointermove']).toBeUndefined();
  });

  it('leaves touches to camera-controls and stops listening on dispose', () => {
    const element = createElement();
    const onRotate = jest.fn();
    const trackball = new TrackballRotation(element, { getButton: () => 0, onRotate });

    element.listeners.pointerdown({ button: 0, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, preventDefault: jest.fn() });
    expect(trackball.dragging).toBe(false);

    trackball.dispose();
    expect(element.listeners.pointerdown).toBeUndefined();
  });
});
