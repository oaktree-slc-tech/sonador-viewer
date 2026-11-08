// Read-only SR measurements as Cornerstone3D annotations: what is stored, and which views show it.
// The Cornerstone3D annotation state is replaced by an in-memory store.

const mockAnnotations = new Map();
const mockRender = jest.fn();
jest.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: {
      addAnnotation: annotation => mockAnnotations.set(annotation.annotationUID, annotation),
      getAnnotation: uid => mockAnnotations.get(uid),
      removeAnnotation: uid => mockAnnotations.delete(uid),
      getAllAnnotations: () => [...mockAnnotations.values()],
    },
  },
  utilities: { triggerAnnotationRenderForViewportIds: ids => mockRender(ids) },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({
  metaData: { get: () => undefined },
  getRenderingEngines: () => [{ getViewports: () => [{ id: 'mpr-axial' }, { id: 'volume-3d' }] }],
}), { virtual: true });

import { planeFromInstance } from './imagePlane';
import {
  addSRDisplayAnnotation, annotationUIDFor, clearSRDisplayAnnotations, getActiveTrackingUniqueIdentifier,
  getSRDisplayAnnotations, isViewable, removeSRDisplayAnnotation, setActiveTrackingUniqueIdentifier,
  setSRDisplayAnnotationVisible, TOOL_NAME,
} from './srDisplayAnnotations';

const axial = planeFromInstance({
  ImagePositionPatient: [0, 0, 40],
  ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  PixelSpacing: [1, 1],
  FrameOfReferenceUID: '2.25.1',
});

const imageLength = {
  TrackingUniqueIdentifier: '2.25.100',
  TrackingIdentifier: 'cornerstoneTools@^4.0.0:Bidirectional',
  labels: [{ label: 'Long Axis', value: '20.00 mm' }],
  coords: [{ ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [10.5, 10.5, 30.5, 10.5] }],
};

// A Length along x at y = 5, z = 40, in patient coordinates
const patientLength = {
  TrackingUniqueIdentifier: '2.25.200',
  labels: [{ label: 'Length', value: '20.00 mm' }],
  coords: [{
    ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData: [0, 5, 40, 20, 5, 40],
    ReferencedFrameOfReferenceSequence: '2.25.1',
  }],
};

const axialView = { viewPlaneNormal: [0, 0, 1], focalPoint: [0, 0, 40], halfSpacing: 0.5 };
const coronalView = { viewPlaneNormal: [0, 1, 0], focalPoint: [0, 5, 0], halfSpacing: 0.5 };
const sagittalView = { viewPlaneNormal: [1, 0, 0], focalPoint: [10, 0, 0], halfSpacing: 0.5 };

beforeEach(() => {
  mockAnnotations.clear();
  setActiveTrackingUniqueIdentifier(null);
  mockRender.mockClear();
});


describe('addSRDisplayAnnotation', () => {
  it('stores image content in patient coordinates, keyed by tracking UID and Frame of Reference', () => {
    const annotation = addSRDisplayAnnotation({ measurement: imageLength, plane: axial, imageId: 'wadors:1' });

    expect(annotation).toMatchObject({
      annotationUID: annotationUIDFor('2.25.100'),
      isLocked: true,
      metadata: { toolName: TOOL_NAME, FrameOfReferenceUID: '2.25.1' },
      data: { TrackingUniqueIdentifier: '2.25.100', referencedImageId: 'wadors:1', labels: imageLength.labels },
    });
    expect(annotation.metadata.referencedImageId).toBeUndefined();
    expect(annotation.data.handles.points).toEqual([[10, 10, 40], [30, 10, 40]]);
    expect(annotation.data.srPlane.sourceNormal).toEqual([0, 0, 1]);
    expect(mockRender).toHaveBeenCalledWith(['mpr-axial', 'volume-3d']);
  });

  it('replaces the annotation of a tracking UID instead of adding a second one', () => {
    addSRDisplayAnnotation({ measurement: imageLength, plane: axial });
    addSRDisplayAnnotation({ measurement: imageLength, plane: axial });
    expect(getSRDisplayAnnotations()).toHaveLength(1);
  });

  it('places SCOORD3D content by its own Frame of Reference, with no image', () => {
    const annotation = addSRDisplayAnnotation({ measurement: patientLength, render: false });
    expect(annotation.metadata.FrameOfReferenceUID).toBe('2.25.1');
    expect(annotation.data.srPlane.sourceNormal).toBeUndefined();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it('adds nothing it cannot draw or place', () => {
    expect(addSRDisplayAnnotation({ measurement: imageLength })).toBeNull(); // image content, no plane
    expect(addSRDisplayAnnotation({
      measurement: { ...patientLength, coords: [{ ...patientLength.coords[0], ReferencedFrameOfReferenceSequence: undefined }] },
    })).toBeNull(); // no Frame of Reference
    expect(addSRDisplayAnnotation({ measurement: { TrackingUniqueIdentifier: '2.25.300', coords: [{ ReferencedSOPSequence: {} }] } })).toBeNull();
    expect(getSRDisplayAnnotations()).toHaveLength(0);
  });
});


describe('isViewable', () => {
  it('shows image content only in views parallel to its image, in the displayed slice', () => {
    const annotation = addSRDisplayAnnotation({ measurement: imageLength, plane: axial });
    expect(isViewable(annotation, axialView)).toBe(true);
    expect(isViewable(annotation, { ...axialView, viewPlaneNormal: [0, 0, -1] })).toBe(true);
    expect(isViewable(annotation, { ...axialView, focalPoint: [0, 0, 41] })).toBe(false);
    expect(isViewable(annotation, { viewPlaneNormal: [0, 1, 0], focalPoint: [0, 10, 0], halfSpacing: 0.5 })).toBe(false);
  });

  it('shows patient content in any view whose slice contains it', () => {
    const annotation = addSRDisplayAnnotation({ measurement: patientLength });
    expect(isViewable(annotation, axialView)).toBe(true);
    expect(isViewable(annotation, coronalView)).toBe(true); // the coronal plane y = 5 holds the line
    expect(isViewable(annotation, sagittalView)).toBe(false); // the line crosses it
  });

  it('shows everything in a 3D view, and nothing hidden', () => {
    const annotation = addSRDisplayAnnotation({ measurement: patientLength });
    expect(isViewable(annotation, { is3D: true })).toBe(true);

    setSRDisplayAnnotationVisible('2.25.200', false);
    expect(isViewable(annotation, { is3D: true })).toBe(false);
  });
});


describe('session state', () => {
  it('tracks the active measurement and clears everything with the session', () => {
    addSRDisplayAnnotation({ measurement: imageLength, plane: axial });
    addSRDisplayAnnotation({ measurement: patientLength });
    setActiveTrackingUniqueIdentifier('2.25.200');
    expect(getActiveTrackingUniqueIdentifier()).toBe('2.25.200');

    expect(removeSRDisplayAnnotation('2.25.100')).toBe(true);
    expect(removeSRDisplayAnnotation('2.25.100')).toBe(false);

    expect(clearSRDisplayAnnotations()).toBe(1);
    expect(getSRDisplayAnnotations()).toHaveLength(0);
    expect(getActiveTrackingUniqueIdentifier()).toBeNull();
  });
});
