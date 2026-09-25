// Orthographic wheel zoom against the real camera-controls (2.10)

import * as THREE from 'three';
import CameraControls from 'camera-controls';

import { accumulateOrthographicZoom } from './cameraControlsFixes';

// camera-controls allocates a DOMRect for its element bounds; node has none
if (typeof global.DOMRect === 'undefined') {
  global.DOMRect = class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) {
      Object.assign(this, { x, y, width, height });
    }
  };
}
CameraControls.install({ THREE });

const FRAME = 1 / 60;
const TICK = Math.pow(0.95, 1); // one wheel step (delta 1, dollySpeed 1)

function createControls({ patched = true, dollyToCursor = false } = {}) {
  const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
  camera.position.set(0, 0, 500);
  const controls = new CameraControls(camera);
  controls.dollyToCursor = dollyToCursor;
  if (patched) {
    accumulateOrthographicZoom(controls);
  }
  return { camera, controls };
}

describe('accumulateOrthographicZoom', () => {
  it('library behaviour it corrects: steps before the next frame are lost', () => {
    const { controls } = createControls({ patched: false });

    controls._zoomInternal(1, 0, 0);
    controls._zoomInternal(1, 0, 0);
    controls._zoomInternal(1, 0, 0);

    expect(controls._zoomEnd).toBeCloseTo(TICK); // three steps, one applied
  });

  it('accumulates every step taken before the next frame', () => {
    const { controls } = createControls();

    controls._zoomInternal(1, 0, 0);
    controls._zoomInternal(1, 0, 0);
    controls._zoomInternal(1, 0, 0);

    expect(controls._zoomEnd).toBeCloseTo(TICK ** 3);
  });

  it('zooms steadily in one direction while scrolling continuously', () => {
    const { camera, controls } = createControls();
    const zooms = [];

    // A wheel step every other frame, while the smoothing is still catching up
    for (let frame = 0; frame < 40; frame++) {
      if (frame % 2 === 0 && frame < 20) {
        controls._zoomInternal(-1, 0, 0); // zoom in
      }
      controls.update(FRAME);
      zooms.push(camera.zoom);
    }
    for (let frame = 0; frame < 200; frame++) {
      controls.update(FRAME);
    }

    const steps = zooms.slice(1).map((zoom, i) => zoom - zooms[i]);
    expect(steps.every(step => step >= -1e-9)).toBe(true); // never zooms back out
    expect(camera.zoom).toBeCloseTo((1 / TICK) ** 10, 4); // all ten steps applied
  });

  it('keeps zoom-to-cursor moving the view towards the cursor', () => {
    const { controls } = createControls({ dollyToCursor: true });
    const start = controls.getTarget(new THREE.Vector3());

    // Zoom in with the cursor near the right edge
    for (let i = 0; i < 5; i++) {
      controls._zoomInternal(-1, 0.8, 0);
    }
    for (let frame = 0; frame < 200; frame++) {
      controls.update(FRAME);
    }

    const target = controls.getTarget(new THREE.Vector3());
    expect(target.x).toBeGreaterThan(start.x);
    expect(Math.abs(target.y - start.y)).toBeLessThan(1e-6);
  });

  it('ignores objects that are not camera controls', () => {
    expect(accumulateOrthographicZoom(undefined)).toBe(false);
    expect(accumulateOrthographicZoom({})).toBe(false);
  });
});
