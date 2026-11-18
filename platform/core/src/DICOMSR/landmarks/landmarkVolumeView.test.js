// The geometry of landmark markers in the 3D volume view: depth along the viewing direction, the
// depth fade from 100 % to 50 % (all at one depth at 100 %), the hovered marker nearest the camera
// among overlapping ones, a marker's strength, the edge mark of a chosen landmark outside the view
// with its chevron, and the orbit that faces a landmark with zoom and focal point unchanged; and the
// "Follow selected landmark" preference.

// The geometry alone: the store and the placement are not read here
jest.mock('./landmarkSetStore', () => ({
  getCurrentLandmark: () => null, getLandmarkSets: () => [], isLandmarkSetVisible: () => true, subscribe: () => ({ unsubscribe: () => {} }),
  EVENTS: { SELECTION_CHANGED: 'selection' },
}));
jest.mock('./landmarkPlacement', () => ({ placementOf: () => ({ placed: true }) }));

import {
  CHEVRON, EDGE_INSET, chevronPrimitives, depthAlong, depthStrengths, edgePlacement, isInView, orbitToward, screenDirection,
} from './landmarkVolumeView';
import { markerAt, markerPrimitives } from './landmarkMarkers';
import { getFollowSelectedLandmark, setFollowSelectedLandmark, subscribeFollowSelectedLandmark } from './landmarkFollow';
import { LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY, UserPreferencesServiceClass } from '../../services/UserPreferencesService/UserPreferencesService';

// The preference service mirrors its events onto document.body, which this node environment lacks
global.CustomEvent = global.CustomEvent || class CustomEvent {
  constructor(type, params = {}) {
    this.type = type;
    this.detail = params.detail;
  }
};
global.document = global.document || { body: { dispatchEvent: () => {} } };

// A camera 500 mm in front of the origin along +y, looking at it, the head up
const CAMERA = { position: [0, 500, 0], focalPoint: [0, 0, 0], viewUp: [0, 0, 1] };
const close = (a, b) => a.forEach((value, i) => expect(value).toBeCloseTo(b[i], 6));
const length = a => Math.hypot(...a);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);


describe('depth and the fade', () => {
  it('measures depth along the viewing direction, not the distance to the camera', () => {
    expect(depthAlong([0, 0, 0], CAMERA)).toBeCloseTo(500);
    // Side by side on one plane facing the camera: one depth, though one is farther from the camera
    expect(depthAlong([80, 0, 0], CAMERA)).toBeCloseTo(500);
    expect(depthAlong([0, -40, 0], CAMERA)).toBeCloseTo(540);
  });

  it('fades from 100 % at the nearest to 50 % at the farthest, linearly', () => {
    expect(depthStrengths([500, 500, 540])).toEqual([1, 1, 0.5]);
    expect(depthStrengths([500, 520, 540])[1]).toBeCloseTo(0.75);
  });

  it('gives a finite 100 % when every landmark is at one depth, a single one included', () => {
    expect(depthStrengths([500, 500])).toEqual([1, 1]);
    expect(depthStrengths([512])).toEqual([1]);
    expect(depthStrengths([])).toEqual([]);
  });

  it('draws a faded marker at its strength, a ghost of the slice views unchanged', () => {
    const faded = markerPrimitives({ x: 10, y: 10, shape: 'Point', line: '#00C0FF' }, { strength: 0.5 });
    expect(faded.map(p => p.opacity)).toEqual([0.5, 0.5]);
    expect(markerPrimitives({ x: 10, y: 10, shape: 'Point', line: '#00C0FF' }).map(p => p.opacity)).toEqual([1, 1]);
  });
});


describe('hover in the 3D view', () => {
  it('answers with the marker nearer the camera where two overlap, though the other centre is nearer the pointer', () => {
    const markers = [{ key: 'near-centre', x: 10, y: 10, depth: 540 }, { key: 'near-camera', x: 16, y: 10, depth: 500 }];
    expect(markerAt(markers, 11, 10).key).toBe('near-camera');
    // Out of the hit radius it does not answer
    expect(markerAt(markers, 0, 10).key).toBe('near-centre');
  });

  it('settles a tie in depth by the nearer centre; the slice views keep the nearer centre', () => {
    expect(markerAt([{ key: 'a', x: 10, y: 10, depth: 500 }, { key: 'b', x: 14, y: 10, depth: 500 }], 13, 10).key).toBe('b');
    expect(markerAt([{ key: 'a', x: 10, y: 10 }, { key: 'b', x: 14, y: 10 }], 11, 10).key).toBe('a');
  });
});


describe('the chosen landmark outside the view', () => {
  it('tells a point in the view from one outside it', () => {
    expect(isInView({ x: 0, y: 400 }, 400, 400)).toBe(true);
    expect(isInView({ x: 401, y: 10 }, 400, 400)).toBe(false);
    expect(isInView({ x: NaN, y: 10 }, 400, 400)).toBe(false);
  });

  it('sits at the nearest edge, inset so its brackets stay in view, and points toward the landmark', () => {
    const right = edgePlacement({ projected: { x: 900, y: 120 }, width: 400, height: 300 });
    expect(right).toMatchObject({ x: 400 - EDGE_INSET, y: 120 });
    expect(right.angle).toBeCloseTo(0);
    const corner = edgePlacement({ projected: { x: -50, y: -50 }, width: 400, height: 300 });
    expect(corner).toMatchObject({ x: EDGE_INSET, y: EDGE_INSET });
    expect(corner.angle).toBeCloseTo(-3 * Math.PI / 4);
  });

  it('for a landmark the projection cannot place, sits where its direction from the centre meets the edge', () => {
    // Behind a perspective camera, up and to the right on the view plane: the camera faces -y with
    // the head up, so the patient's -x is to its right
    const direction = screenDirection([-100, 0, 100], CAMERA);
    expect(direction.dx).toBeGreaterThan(0);
    expect(direction.dy).toBeLessThan(0);
    const edge = edgePlacement({ projected: null, direction, width: 400, height: 400 });
    expect(edge).toMatchObject({ x: 400 - EDGE_INSET, y: EDGE_INSET });
    expect(edge.angle).toBeCloseTo(-Math.PI / 4);
  });

  it('for a landmark straight behind the camera, with no direction on the view plane, sits mid-bottom pointing down', () => {
    expect(screenDirection([0, 700, 0], CAMERA)).toBeNull();
    const edge = edgePlacement({ projected: null, direction: null, width: 400, height: 300 });
    expect(edge).toMatchObject({ x: 200, y: 300 - EDGE_INSET });
    expect(edge.angle).toBeCloseTo(Math.PI / 2);
  });

  it('draws the chevron in the Line colour over the casing, its apex toward the landmark', () => {
    const [casing, chevron] = chevronPrimitives({ x: 100, y: 50 }, 0, '#FF0000');
    expect(casing).toMatchObject({ stroke: '#000000', width: CHEVRON.CASING });
    expect(chevron).toMatchObject({ stroke: '#FF0000', width: CHEVRON.STROKE, opacity: 1 });
    close(chevron.points[1], [100 + CHEVRON.HALF_LENGTH, 50]);
    const down = chevronPrimitives({ x: 100, y: 50 }, Math.PI / 2, '#FF0000')[1];
    close(down.points[1], [100, 50 + CHEVRON.HALF_LENGTH]);
  });
});


describe('the orbit that faces a landmark', () => {
  it('brings a landmark at the back to the front: the camera on the line from the focal point through it, at its distance', () => {
    const turned = orbitToward(CAMERA, [0, -80, 20]);
    expect(turned.focalPoint).toEqual([0, 0, 0]);
    expect(length(turned.position)).toBeCloseTo(500);
    close(turned.position.map(v => v / 500), [0, -80 / Math.hypot(80, 20), 20 / Math.hypot(80, 20)]);
    // The landmark is now nearer the camera than the focal point
    expect(depthAlong([0, -80, 20], turned)).toBeLessThan(depthAlong([0, 0, 0], turned));
    // View up stays across the viewing direction
    expect(dot(turned.viewUp, turned.position)).toBeCloseTo(0);
    expect(length(turned.viewUp)).toBeCloseTo(1);
  });

  it('keeps a view up when the turn is onto the old one', () => {
    const turned = orbitToward(CAMERA, [0, 0, 50]);
    close(turned.position, [0, 0, 500]);
    close(turned.viewUp, [0, -1, 0]);
  });

  it('leaves the camera where it is for a landmark at the focal point', () => {
    expect(orbitToward(CAMERA, [0, 0, 0])).toBeNull();
  });
});


describe('Follow selected landmark', () => {
  const memoryStorage = () => {
    const items = {};
    return { items, getItem: key => (key in items ? items[key] : null), setItem: (key, value) => { items[key] = String(value); }, removeItem: key => delete items[key] };
  };

  it('is off by default, set on the user behalf, and announced when turned on', async () => {
    const service = new UserPreferencesServiceClass({ storage: memoryStorage() });
    expect(getFollowSelectedLandmark(service)).toBe(false);
    const heard = [];
    const { unsubscribe } = subscribeFollowSelectedLandmark((value, { hydrated }) => heard.push([value, hydrated]), service);
    await setFollowSelectedLandmark(true, service);
    expect(getFollowSelectedLandmark(service)).toBe(true);
    expect(service.getGeneral(LANDMARKS_FOLLOW_SELECTION_PREFERENCE_KEY)).toBe(true);
    expect(heard).toEqual([[true, false]]);
    unsubscribe();
    await setFollowSelectedLandmark(false, service);
    expect(heard).toHaveLength(1);
  });
});
