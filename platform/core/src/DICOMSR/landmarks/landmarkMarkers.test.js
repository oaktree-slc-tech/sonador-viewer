// The markers of landmark sets in the slice views: the slice rule (full within half a spacing, a
// ghost up to two spacings off when the displayed stack reaches the landmark, one or two slices away,
// earlier or later), the three shapes with their casing, the hovered and ghost forms with the caret,
// the brackets drawn in over 300 ms, the name plate that turns white for a dark Text colour, the
// marker the pointer answers to, and the landmarks a view shows, over the Sonador IO fixtures.

import fs from 'fs';
import path from 'path';
import { data as dcmjsData } from 'dcmjs';

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: { CORNERSTONEFREETEXT: 'CORNERSTONEFREETEXT' } } } },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../measurements/classes', () => ({ MeasurementApi: {} }));
jest.mock('../../measurements/enums', () => {
  const Enums = { SREnums: jest.requireActual('../enums').Enums, EVENTS: {}, Cornerstone3D: { sr: {} } };
  return { __esModule: true, default: Enums, Enums };
});
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../log', () => ({ __esModule: true, get default() { return mockLog; } }));

import { readDicomFile } from '../../utils/dicomCharacterSet';
import { clearHydratedReports } from '../utils/srDocument';
import { addLandmarkSetsOf, getLandmarkSets, selectLandmark, setLandmarkSetVisible } from './landmarkSetStore';

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};

const STUDY = '2.25.1001';
const MR = '1.2.840.10008.5.1.4.1.1.4';
const P_FOR = '2.25.45100';
const S_FOR = '2.25.45200';

// The synthetic study: series P (one image, frame P); frame S holds no set; the reports' series
const P = { SeriesInstanceUID: '2.25.1002', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.1003', SOPClassUID: MR, FrameOfReferenceUID: P_FOR, Modality: 'MR', Rows: 64, Columns: 64 }] };

function metadataStore(series) {
  // The DicomMetadataStore read accessors, counted: nothing else is called
  const store = { series: [...series] };
  const study = () => ({ StudyInstanceUID: STUDY, series: store.series });
  Object.assign(store, {
    getStudyInstanceUIDs: jest.fn(() => [STUDY]),
    getStudy: jest.fn(uid => (uid === STUDY ? study() : undefined)),
    getSeries: jest.fn((uid, seriesUid) => (uid === STUDY ? store.series.find(s => s.SeriesInstanceUID === seriesUid) : undefined)),
    load: series_ => store.series.push(series_),
    unload: uid => { store.series = store.series.filter(s => s.SeriesInstanceUID !== uid); },
  });
  return store;
}

import {
  bracketPrimitives, bracketSize, contrastRatio, ghostLabel, markerAt, markerPrimitives, platePrimitives, sliceClass, viewLandmarks,
} from './landmarkMarkers';

beforeEach(() => {
  clearHydratedReports();
});


describe('the slice rule', () => {
  it('draws in full within half a spacing, and as a ghost up to two spacings off', () => {
    expect(sliceClass(0, 3, true)).toEqual({ kind: 'full' });
    expect(sliceClass(1.5, 3, true)).toEqual({ kind: 'full' });
    expect(sliceClass(-1.5, 3, true)).toEqual({ kind: 'full' });
    expect(sliceClass(1.5001, 3, true)).toEqual({ kind: 'ghost', steps: 1, direction: 'later' });
    expect(sliceClass(-3, 3, true)).toEqual({ kind: 'ghost', steps: 1, direction: 'earlier' });
    expect(sliceClass(6, 3, true)).toEqual({ kind: 'ghost', steps: 2, direction: 'later' });
    expect(sliceClass(-5, 3, true)).toEqual({ kind: 'ghost', steps: 2, direction: 'earlier' });
    expect(sliceClass(6.0001, 3, true)).toEqual({ kind: 'none' });
    expect(sliceClass(9, 3, true)).toEqual({ kind: 'none' });
  });

  it('draws no ghost for a landmark the displayed stack cannot reach', () => {
    expect(sliceClass(1, 1, false)).toEqual({ kind: 'none' });
    expect(sliceClass(0.5, 1, false)).toEqual({ kind: 'full' });
  });

  it('draws nothing without a spacing or a distance', () => {
    expect(sliceClass(0, 0, true)).toEqual({ kind: 'none' });
    expect(sliceClass(NaN, 1, true)).toEqual({ kind: 'none' });
  });
});


describe('the shapes', () => {
  const at = { x: 100, y: 50, line: '#00C0FF' };
  const strokes = primitives => primitives.map(p => [p.type, p.stroke, p.width]);

  it('draws a Point as an open cross 13 px across with a 5 px gap, over its casing', () => {
    const primitives = markerPrimitives({ ...at, shape: 'Point' });
    expect(strokes(primitives)).toEqual([['lines', '#000000', 3.5], ['lines', '#00C0FF', 1.5]]);
    expect(primitives[0].strokeOpacity).toBe(0.85);
    expect(primitives[1].segments).toEqual([[93.5, 50, 97.5, 50], [102.5, 50, 106.5, 50], [100, 43.5, 100, 47.5], [100, 52.5, 100, 56.5]]);
  });

  it('draws an Anatomic landmark as a diamond 13 px across with a centre dot', () => {
    const primitives = markerPrimitives({ ...at, shape: 'Anatomic' });
    expect(primitives.map(p => p.type)).toEqual(['polygon', 'polygon', 'circle']);
    expect(primitives[1].points).toEqual([[100, 43.5], [106.5, 50], [100, 56.5], [93.5, 50]]);
    expect(primitives[2]).toMatchObject({ cx: 100, cy: 50, r: 1.8, fill: '#00C0FF', stroke: '#000000', width: 1 });
  });

  it('draws a Registration landmark as a 9 px ring with four outer ticks, 16 px across', () => {
    const primitives = markerPrimitives({ ...at, shape: 'Registration' });
    expect(primitives.map(p => p.type)).toEqual(['circle', 'lines', 'circle', 'lines']);
    expect(primitives[2]).toMatchObject({ r: 4.5, stroke: '#00C0FF', width: 1.5 });
    expect(primitives[3].segments[0]).toEqual([92, 50, 95.5, 50]);
  });

  it('thickens a hovered marker to 2 px over a 4 px casing', () => {
    expect(strokes(markerPrimitives({ ...at, shape: 'Point' }, { hovered: true }))).toEqual([['lines', '#000000', 4], ['lines', '#00C0FF', 2]]);
  });

  it('draws a ghost at 70 % size, 65 % strength one slice away and 40 % two, with its caret above for a later slice', () => {
    const later = markerPrimitives({ ...at, shape: 'Point' }, { ghost: { steps: 1, direction: 'later' } });
    expect(later.map(p => p.opacity)).toEqual([0.65, 0.65, 0.65, 0.65]);
    expect(later[1].segments[0]).toEqual([100 - 6.5 * 0.7, 50, 100 - 2.5 * 0.7, 50]);
    const caret = later[3];
    expect(caret.type).toBe('polyline');
    expect(caret.points[1]).toEqual([100, 50 - 10.55]);

    const earlier = markerPrimitives({ ...at, shape: 'Point' }, { ghost: { steps: 2, direction: 'earlier' } });
    expect(earlier[0].opacity).toBe(0.4);
    expect(earlier[3].points[1]).toEqual([100, 50 + 10.55]);
  });

  it('thickens a hovered ghost to 2 px, keeping its size, strength and caret', () => {
    [1, 2].forEach((steps) => {
      const ghost = { steps, direction: 'later' };
      const idle = markerPrimitives({ ...at, shape: 'Point' }, { ghost });
      const hovered = markerPrimitives({ ...at, shape: 'Point' }, { ghost, hovered: true });
      expect(idle[1].width).toBe(1.25);
      expect(hovered[1].width).toBe(2);
      expect(hovered[0].width).toBeCloseTo(3.4);
      expect(hovered[1].segments).toEqual(idle[1].segments);
      expect(hovered.map(p => p.opacity)).toEqual(idle.map(p => p.opacity));
      expect(hovered.slice(2)).toEqual(idle.slice(2));
    });
  });

  it('names a ghost with its offset', () => {
    expect(ghostLabel('Label only', { steps: 1, direction: 'earlier' })).toBe('Label only \u00B7 1 slice earlier');
    expect(ghostLabel('Tear drop', { steps: 2, direction: 'later' })).toBe('Tear drop \u00B7 2 slices later');
  });
});


describe('the brackets', () => {
  it('are drawn in from 38 px to 26 px over 300 ms', () => {
    expect(bracketSize(0)).toBe(38);
    expect(bracketSize(300)).toBe(26);
    expect(bracketSize(1000)).toBe(26);
    expect(bracketSize(150)).toBeGreaterThan(26);
    expect(bracketSize(150)).toBeLessThan(38);
  });

  it('are white corners 26 px across, 6 px arms, over a black casing', () => {
    const primitives = bracketPrimitives({ x: 100, y: 50 });
    expect(primitives).toHaveLength(8);
    expect(primitives[4]).toMatchObject({ stroke: '#FFFFFF', width: 2 });
    expect(primitives[0]).toMatchObject({ stroke: '#000000', width: 4 });
    expect(primitives[4].points).toEqual([[87, 43], [87, 37], [93, 37]]);
  });
});


describe('the name plate', () => {
  const measure = text => text.length * 6;

  it('is black at 78 % up and to the right of the marker, the name in the Text colour, 12 px semibold', () => {
    const [plate, text] = platePrimitives({ x: 100, y: 50 }, 'Tear drop', '#FFFFFF', measure);
    expect(plate).toMatchObject({ type: 'rect', x: 110.5, y: 28, width: 9 * 6 + 12, height: 15, fill: '#000000', fillOpacity: 0.78 });
    expect(text).toMatchObject({ type: 'text', text: 'Tear drop', fill: '#FFFFFF', x: 116.5 });
    expect(text.font).toMatch(/^600 12px /);
  });

  it('turns white when the Text colour has less than 4.5:1 against black', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(platePrimitives({ x: 0, y: 0 }, 'Dark', '#000080', measure)[0].fill).toBe('#FFFFFF');
    expect(platePrimitives({ x: 0, y: 0 }, 'Bright', '#FFFF00', measure)[0].fill).toBe('#000000');
  });
});


describe('the marker the pointer answers to', () => {
  const markers = [{ key: 'a', x: 100, y: 100 }, { key: 'b', x: 108, y: 100 }];

  it('is the one whose centre is nearest, within 11 px', () => {
    expect(markerAt(markers, 103, 100).key).toBe('a');
    expect(markerAt(markers, 105, 100).key).toBe('b');
    expect(markerAt(markers, 119, 100).key).toBe('b');
    expect(markerAt(markers, 119.01, 100)).toBeUndefined();
  });
});


describe('the landmarks a view shows', () => {
  it("the visible patient-domain sets of the view's Frame of Reference, with their colours, shapes and names", () => {
    const store = metadataStore([P]);
    addLandmarkSetsOf(fixture('landmarks-mixed'), store);
    const shown = viewLandmarks({ frameOfReferenceUID: P_FOR });
    expect(shown).toHaveLength(10);
    expect(shown[0]).toMatchObject({ domain: 'patient', shape: 'Anatomic', name: 'Left anterior superior iliac spine', line: '#FF0000', current: false });
    expect(shown[1]).toMatchObject({ shape: 'Point', line: '#00C0FF', text: '#FFFFFF' });
    expect(viewLandmarks({ frameOfReferenceUID: S_FOR })).toEqual([]);

    setLandmarkSetVisible(getLandmarkSets()[0].key, false);
    expect(viewLandmarks({ frameOfReferenceUID: P_FOR })).toEqual([]);
  });

  it('marks the current landmark', () => {
    addLandmarkSetsOf(fixture('landmarks-mixed'), metadataStore([P]));
    selectLandmark(getLandmarkSets()[0].key, 2);
    expect(viewLandmarks({ frameOfReferenceUID: P_FOR }).filter(landmark => landmark.current).map(landmark => landmark.index)).toEqual([2]);
  });

  it('an image-domain set on its own image only, in the default colour when it stores none, and never in a view of a frame alone', () => {
    const store = metadataStore([P]);
    addLandmarkSetsOf(fixture('landmarks-image'), store);
    const onImage = viewLandmarks({ frameOfReferenceUID: P_FOR, image: { sopInstanceUID: '2.25.1003', frameNumber: 1 }, store });
    expect(onImage.map(landmark => [landmark.domain, landmark.line])).toEqual([['image', '#FFFF00'], ['image', '#FFFF00'], ['image', '#FFFF00']]);
    expect(viewLandmarks({ frameOfReferenceUID: P_FOR, image: { sopInstanceUID: '2.25.1003', frameNumber: 2 }, store })).toEqual([]);
    expect(viewLandmarks({ frameOfReferenceUID: P_FOR, image: { sopInstanceUID: '2.25.9999', frameNumber: 1 }, store })).toEqual([]);
    expect(viewLandmarks({ frameOfReferenceUID: P_FOR, store })).toEqual([]);
  });
});
