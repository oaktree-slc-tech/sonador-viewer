/**
 * @jest-environment ../../platform/viewer/src/__tests__/jsdomEnvironment.js
 */
// The arrow markers of a view: hovering a ring (within its hit radius) shows the arrow's label; a
// primary press on a ring brings the view to the arrow before the active tool takes the press; a
// point is near a slice less than one slice spacing from it; the nearest image plane to a point.

import {
  MARKER_HIT_RADIUS, arrowMarkerAt, clearArrowMarkers, distanceFromImagePlane, isNearSlice, nearestImageIndex,
  setArrowMarkers, subscribeArrowMarkerHover,
} from './arrowMarkers';

function viewElement() {
  // An element whose canvas sits at (100, 50) on the page
  const element = document.createElement('div');
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 200, height: 200 });
  element.appendChild(canvas);
  document.body.appendChild(element);
  return { element, canvas };
}

const mouse = (target, type, init) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));

it('finds the ring under a point within its hit radius', () => {
  const { element, canvas } = viewElement();
  setArrowMarkers(element, canvas, [{ x: 20, y: 30, label: 'Lesion margin', activate: () => {} }]);
  expect(arrowMarkerAt(element, 120, 80).marker.label).toBe('Lesion margin');
  expect(arrowMarkerAt(element, 120 + MARKER_HIT_RADIUS - 1, 80)).not.toBeNull();
  expect(arrowMarkerAt(element, 120 + MARKER_HIT_RADIUS + 1, 80)).toBeNull();
});

it("shows the label of the ring under the pointer, and nothing once it leaves or the ring is gone", () => {
  const { element, canvas } = viewElement();
  const hovers = [];
  const unsubscribe = subscribeArrowMarkerHover(hover => hovers.push(hover && hover.label));
  setArrowMarkers(element, canvas, [{ x: 20, y: 30, label: 'Lesion margin', activate: () => {} }]);

  mouse(canvas, 'mousemove', { clientX: 121, clientY: 81 });
  expect(hovers[hovers.length - 1]).toBe('Lesion margin');
  mouse(element, 'mouseleave', {});
  expect(hovers[hovers.length - 1]).toBeNull();

  mouse(canvas, 'mousemove', { clientX: 121, clientY: 81 });
  setArrowMarkers(element, canvas, []);
  expect(hovers[hovers.length - 1]).toBeNull();
  unsubscribe();
});

it('takes a primary press on a ring before the tools, and leaves other presses to them', () => {
  const { element, canvas } = viewElement();
  const activate = jest.fn();
  const tool = jest.fn();
  element.addEventListener('mousedown', tool);
  setArrowMarkers(element, canvas, [{ x: 20, y: 30, label: 'Lesion margin', activate }]);

  mouse(canvas, 'mousedown', { clientX: 120, clientY: 80, button: 0 });
  expect(activate).toHaveBeenCalledTimes(1);
  expect(tool).not.toHaveBeenCalled();

  mouse(canvas, 'mousedown', { clientX: 120, clientY: 80, button: 2 });
  mouse(canvas, 'mousedown', { clientX: 180, clientY: 180, button: 0 });
  expect(activate).toHaveBeenCalledTimes(1);
  expect(tool).toHaveBeenCalledTimes(2);
});

const touch = (target, type, points) => {
  // A native touch event: jsdom has no Touch constructor
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: points });
  target.dispatchEvent(event);
  return event;
};

it('takes a one-finger tap on a ring once, before the tools; other touches go to them', () => {
  const { element, canvas } = viewElement();
  const activate = jest.fn();
  const tool = jest.fn();
  element.addEventListener('touchstart', tool);
  setArrowMarkers(element, canvas, [{ x: 20, y: 30, label: 'Lesion margin', activate }]);

  const tap = touch(canvas, 'touchstart', [{ clientX: 120, clientY: 80 }]);
  expect(activate).toHaveBeenCalledTimes(1);
  // Its emulated mouse events are prevented
  expect(tap.defaultPrevented).toBe(true);
  expect(tool).not.toHaveBeenCalled();

  // Off the ring, and a two-finger pinch on it, reach the tools; the mouse still works
  touch(canvas, 'touchstart', [{ clientX: 190, clientY: 190 }]);
  touch(canvas, 'touchstart', [{ clientX: 120, clientY: 80 }, { clientX: 150, clientY: 120 }]);
  expect(tool).toHaveBeenCalledTimes(2);
  mouse(canvas, 'mousedown', { clientX: 120, clientY: 80, button: 0 });
  expect(activate).toHaveBeenCalledTimes(2);
});

it("forgets a viewport's rings and its hover when it goes, leaving another viewport's hover", () => {
  const first = viewElement();
  const second = viewElement();
  const hovers = [];
  const unsubscribe = subscribeArrowMarkerHover(hover => hovers.push(hover && hover.label));
  setArrowMarkers(first.element, first.canvas, [{ x: 20, y: 30, label: 'First', activate: () => {} }]);
  setArrowMarkers(second.element, second.canvas, [{ x: 20, y: 30, label: 'Second', activate: () => {} }]);

  // Hovered, then removed without a mouseleave
  mouse(first.canvas, 'mousemove', { clientX: 120, clientY: 80 });
  expect(hovers[hovers.length - 1]).toBe('First');
  first.element.remove();
  expect(arrowMarkerAt(first.element, 120, 80)).toBeNull();
  clearArrowMarkers(first.element);
  expect(hovers[hovers.length - 1]).toBeNull();

  // A clean replacement view; clearing the old one again leaves its hover
  mouse(second.canvas, 'mousemove', { clientX: 120, clientY: 80 });
  expect(hovers[hovers.length - 1]).toBe('Second');
  clearArrowMarkers(first.element);
  expect(hovers[hovers.length - 1]).toBe('Second');
  unsubscribe();
});

it('finds the image plane nearest a point along its normal', () => {
  const axial = z => ({ imagePositionPatient: [0, 0, z], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] });
  expect(nearestImageIndex([axial(0), axial(3), axial(6)], [10, 10, 4])).toBe(1);
  expect(nearestImageIndex([undefined, axial(6)], [0, 0, 0])).toBe(1);
  expect(nearestImageIndex([undefined], [0, 0, 0])).toBe(-1);
});

it('counts a point near a slice less than one slice spacing away: both slices it falls between, only the one it lies on', () => {
  const axial = z => ({ imagePositionPatient: [0, 0, z], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0] });
  const nearSlices = point => [0, 3, 6, 9].filter(z => isNearSlice(distanceFromImagePlane(axial(z), point), 3));
  expect(nearSlices([10, 10, 4])).toEqual([3, 6]);
  expect(nearSlices([10, 10, 6])).toEqual([6]);
  expect(nearSlices([10, 10, 20])).toEqual([]);
  expect(distanceFromImagePlane(undefined, [0, 0, 0])).toBeNaN();
});
