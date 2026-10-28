// Moving a view onto a segment: the 2D translation, the 3D fit that keeps the direction, and the
// animation between cameras

import { animateCamera, FIT_MARGIN, FRAME_DURATION_MS, framedCamera, lerpCamera, pannedCamera } from './frameSegment';

const axial = { position: [10, 20, 130], focalPoint: [10, 20, 30], viewUp: [0, -1, 0], parallelScale: 50, parallelProjection: true };

describe('pannedCamera', () => {
  it('moves the focal point to the centre and the position with it, keeping direction and zoom', () => {
    const moved = pannedCamera(axial, [40, 50, 60]);
    expect(moved).toEqual({ focalPoint: [40, 50, 60], position: [40, 50, 160] });
    expect(pannedCamera(undefined, [0, 0, 0])).toBeNull();
    expect(pannedCamera(axial, undefined)).toBeNull();
  });
});

describe('framedCamera', () => {
  const extent = { center: [40, 50, 60], radius: 20 };

  it('keeps a parallel camera\'s direction and distance, and zooms to the radius plus the margin', () => {
    const framed = framedCamera(axial, extent);
    expect(framed.focalPoint).toEqual([40, 50, 60]);
    expect(framed.position).toEqual([40, 50, 160]);
    expect(framed.parallelScale).toBeCloseTo(20 * FIT_MARGIN);
    expect(FIT_MARGIN).toBe(1.1);
  });

  it('zooms out by the aspect when the view is narrower than tall, not when it is wider', () => {
    expect(framedCamera(axial, extent, { aspect: 0.5 }).parallelScale).toBeCloseTo(20 * FIT_MARGIN / 0.5);
    expect(framedCamera(axial, extent, { aspect: 2 }).parallelScale).toBeCloseTo(20 * FIT_MARGIN);
  });

  it('places a perspective camera where its view angle frames the extent', () => {
    const perspective = { ...axial, parallelProjection: false, viewAngle: 90 };
    const framed = framedCamera(perspective, extent);
    expect(framed.parallelScale).toBeUndefined();
    expect(framed.focalPoint).toEqual([40, 50, 60]);
    // half-height 22 over tan(45°) plus the radius, along the kept direction (+z)
    expect(framed.position[2]).toBeCloseTo(60 + 22 + 20);
    expect(framed.position.slice(0, 2)).toEqual([40, 50]);
  });

  it('frames the bounding sphere when the extent carries one, not its slice target', () => {
    // A hollow segment: the slice target moved onto one wall, the frame over the whole box
    const hollow = { center: [0, 50, 60], radius: 45, frame: { center: [40, 50, 60], radius: 25 } };
    const framed = framedCamera(axial, hollow);
    expect(framed.focalPoint).toEqual([40, 50, 60]);
    expect(framed.position).toEqual([40, 50, 160]);
    expect(framed.parallelScale).toBeCloseTo(25 * FIT_MARGIN);
  });

  it('frames an empty-radius extent at a minimal size, and returns null without a camera or centre', () => {
    expect(framedCamera(axial, { center: [1, 2, 3], radius: 0 }).parallelScale).toBeGreaterThan(0);
    expect(framedCamera(undefined, extent)).toBeNull();
    expect(framedCamera(axial, {})).toBeNull();
  });
});

describe('lerpCamera', () => {
  it('interpolates the numbers and arrays `to` carries, and copies what `from` lacks', () => {
    const between = lerpCamera({ position: [0, 0, 0], parallelScale: 10, viewUp: [0, 1, 0] }, { position: [10, 20, 30], parallelScale: 20, viewUp: [1, 0, 0], parallelProjection: true }, 0.25);
    expect(between).toEqual({ position: [2.5, 5, 7.5], parallelScale: 12.5, viewUp: [0.25, 0.75, 0], parallelProjection: true });
    expect(lerpCamera({}, { focalPoint: [1, 2, 3] }, 0.5)).toEqual({ focalPoint: [1, 2, 3] });
  });
});

describe('animateCamera', () => {
  it('applies the target at once with no duration, and reports done', () => {
    const apply = jest.fn();
    const onDone = jest.fn();
    animateCamera({ from: axial, to: { focalPoint: [1, 1, 1] }, apply, duration: 0, onDone });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ focalPoint: [1, 1, 1] });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('eases from one camera to the other over the duration on the animation frames, ending exactly on the target', () => {
    const frames = [];
    let clock = 1000;
    const apply = jest.fn();
    const onDone = jest.fn();
    animateCamera({
      from: { focalPoint: [0, 0, 0], position: [0, 0, 100] },
      to: { focalPoint: [100, 0, 0], position: [100, 0, 100] },
      apply, onDone, duration: 200, raf: cb => frames.push(cb), now: () => clock,
    });
    expect(frames).toHaveLength(1);
    clock = 1050; // a quarter in: ease-in-out gives 2 * 0.25^2 = 0.125
    frames.shift()(clock);
    expect(apply).toHaveBeenLastCalledWith({ focalPoint: [12.5, 0, 0], position: [12.5, 0, 100] });
    clock = 1100;
    frames.shift()(clock);
    expect(apply).toHaveBeenLastCalledWith({ focalPoint: [50, 0, 0], position: [50, 0, 100] });
    expect(onDone).not.toHaveBeenCalled();
    clock = 1300;
    frames.shift()(clock);
    expect(apply).toHaveBeenLastCalledWith({ focalPoint: [100, 0, 0], position: [100, 0, 100] });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    expect(FRAME_DURATION_MS).toBe(250);
  });

  it('stops where it is when cancelled, without reporting done', () => {
    const frames = [];
    let clock = 0;
    const apply = jest.fn();
    const onDone = jest.fn();
    const cancel = animateCamera({
      from: { parallelScale: 10 }, to: { parallelScale: 20 }, apply, onDone, duration: 100, raf: cb => frames.push(cb), now: () => clock,
    });
    clock = 50;
    frames.shift()(clock);
    expect(apply).toHaveBeenCalledTimes(1);
    cancel();
    clock = 200;
    frames.shift()(clock);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
