// The landmark sets of a session: identity by document and tracking UID, placement against the loaded
// series (followed as series are loaded and unloaded), the exact-image rule of image-domain sets,
// series attribution, and no request beyond the documents already loaded. The metadata store is a
// synthetic one with the DicomMetadataStore interface.

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
import { addLandmarkSetsOf, getLandmarkSets, subscribe } from './landmarkSetStore';
import { attributionOf, HELD_NOTES, placementOf } from './landmarkPlacement';

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

// The synthetic study: series P (one image, frame P) and S (one image, frame S); the reports' series
const P = { SeriesInstanceUID: '2.25.1002', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.1003', SOPClassUID: MR, FrameOfReferenceUID: P_FOR, Modality: 'MR', Rows: 64, Columns: 64 }] };
const S = { SeriesInstanceUID: '2.25.45201', Modality: 'MR', instances: [{ SOPInstanceUID: '2.25.45202', SOPClassUID: MR, FrameOfReferenceUID: S_FOR, Modality: 'MR' }] };

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

const reportSeries = dataset => ({ SeriesInstanceUID: dataset.SeriesInstanceUID, Modality: 'SR', instances: [{ SOPInstanceUID: dataset.SOPInstanceUID, Modality: 'SR' }] });

beforeEach(() => {
  clearHydratedReports();
  Object.values(mockLog).forEach(fn => fn.mockClear());
  global.fetch = jest.fn();
});


describe('identity', () => {
  it('the same tracking UID in two documents gives two entries; a document processed again adds none', () => {
    const store = metadataStore([P, S]);
    const patient = fixture('landmarks-patient');
    const exchange = fixture('landmarks-exchange');
    expect(addLandmarkSetsOf(patient, store)).toBe(1);
    expect(addLandmarkSetsOf(exchange, store)).toBe(1);
    expect(addLandmarkSetsOf(patient, store)).toBe(0);
    expect(addLandmarkSetsOf(exchange, store)).toBe(0);

    const entries = getLandmarkSets();
    expect(entries.map(entry => entry.key)).toEqual([
      `${patient.SOPInstanceUID}::2.25.47201`, `${exchange.SOPInstanceUID}::2.25.47201`,
    ]);
    expect(entries.map(entry => entry.document.kind)).toEqual(['application', 'exchange']);
  });

  it('notifies on change, and is emptied with the measurement session', () => {
    const listener = jest.fn();
    const { unsubscribe } = subscribe(listener);
    addLandmarkSetsOf(fixture('landmarks-patient'), metadataStore([P]));
    expect(listener).toHaveBeenCalledTimes(1);
    clearHydratedReports();
    expect(getLandmarkSets()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    // A new session reads the document again
    expect(addLandmarkSetsOf(fixture('landmarks-patient'), metadataStore([P]))).toBe(1);
    unsubscribe();
  });

  it('lists the sets of every fixture, with the warnings of what it could not read in one log line per document', () => {
    const store = metadataStore([P, S]);
    ['landmarks-patient', 'landmarks-exchange', 'landmarks-mixed', 'landmarks-image', 'landmarks-application-frame',
      'point-collection-legacy', 'point-collection-legacy-mixed-frames'].forEach(topic => addLandmarkSetsOf(fixture(topic), store));
    expect(getLandmarkSets().map(entry => entry.set.trackingUid)).toEqual([
      '2.25.47201', '2.25.47201', '2.25.47201', '2.25.47202', '2.25.47203', '2.25.47204', '2.25.47205', '2.25.47206', '2.25.47207',
      '2.25.47208',
    ]);
    const warned = mockLog.warn.mock.calls.filter(([message]) => /landmark content not read as written/.test(message));
    expect(warned).toHaveLength(1);
    expect(warned[0][1]).toEqual(['landmark-set-mixed-frames 2.25.47208']);
  });
});


describe('placement', () => {
  it('a patient-domain set is placed while a series of its frame is loaded, and held otherwise, keeping its one entry', () => {
    const store = metadataStore([S]);
    addLandmarkSetsOf(fixture('landmarks-patient'), store);
    const [entry] = getLandmarkSets();
    expect(placementOf(entry.set, store)).toEqual({ placed: false, reason: 'frame-not-loaded', note: HELD_NOTES['frame-not-loaded'], series: [] });
    expect(HELD_NOTES['frame-not-loaded']).toBe("No loaded series shares this measurement's frame of reference.");

    store.load(P);
    const placed = placementOf(entry.set, store);
    expect(placed.placed).toBe(true);
    expect(placed.series.map(series => series.SeriesInstanceUID)).toEqual([P.SeriesInstanceUID]);

    store.unload(P.SeriesInstanceUID);
    expect(placementOf(entry.set, store).placed).toBe(false);
    expect(getLandmarkSets()).toHaveLength(1);
  });

  it('sets in an application frame and in a parentless root frame are held', () => {
    const store = metadataStore([P, S]);
    addLandmarkSetsOf(fixture('landmarks-application-frame'), store);
    expect(getLandmarkSets().map(entry => placementOf(entry.set, store).reason)).toEqual(['frame-not-loaded', 'frame-not-loaded']);
  });

  it('an image-domain set is placed when its instance is loaded, and held with its own note otherwise', () => {
    const store = metadataStore([P]);
    addLandmarkSetsOf(fixture('landmarks-image'), store);
    const [first, second] = getLandmarkSets();
    expect(placementOf(first.set, store)).toMatchObject({ placed: true, instance: P.instances[0] });
    expect(placementOf(second.set, store)).toEqual({ placed: false, reason: 'image-not-loaded', note: HELD_NOTES['image-not-loaded'], series: [] });
    expect(HELD_NOTES['image-not-loaded']).toBe('The image this landmark set was placed on is not loaded.');
    store.load(S);
    expect(placementOf(second.set, store).placed).toBe(true);
  });

  it('an image-domain set is placed only on its exact instance and frame', () => {
    const twoFrames = { SOPInstanceUID: '2.25.800', SOPClassUID: '1.2.840.10008.5.1.4.1.1.4.1', NumberOfFrames: '2', FrameOfReferenceUID: P_FOR, Modality: 'MR' };
    const coplanar = { SOPInstanceUID: '2.25.801', SOPClassUID: MR, FrameOfReferenceUID: P_FOR, Modality: 'MR' };
    const store = metadataStore([{ SeriesInstanceUID: '2.25.80', Modality: 'MR', instances: [twoFrames, coplanar] }]);
    const set = frame => ({ domain: 'image', image: { sopInstanceUID: '2.25.800', sopClassUID: MR, frameNumber: frame } });
    expect(placementOf(set(2), store)).toMatchObject({ placed: true, instance: twoFrames });
    expect(placementOf(set(1), store).placed).toBe(true);
    // A frame the instance does not have, or a multiframe instance without a frame: no match, never a
    // fall back to the instance
    expect(placementOf(set(3), store).placed).toBe(false);
    expect(placementOf(set(undefined), store).placed).toBe(false);
    // A single-frame instance: no frame number, or frame 1
    const single = frame => ({ domain: 'image', image: { sopInstanceUID: '2.25.801', sopClassUID: MR, frameNumber: frame } });
    expect([undefined, 1, 2].map(frame => placementOf(single(frame), store).placed)).toEqual([true, true, false]);
  });

  it('warns of image coordinates outside a loaded image, and keeps the landmark', () => {
    const dataset = fixture('landmarks-image');
    const store = metadataStore([{ ...P, instances: [{ ...P.instances[0], Rows: 30, Columns: 20 }] }]);
    addLandmarkSetsOf(dataset, store);
    // (30.25, 40) is outside an image of 20 columns and 30 rows
    expect(getLandmarkSets()[0].set.landmarks).toHaveLength(3);
    const [, warnings] = mockLog.warn.mock.calls.find(([message]) => /not read as written/.test(message));
    expect(warnings).toEqual(['landmark-point-out-of-bounds 2.25.47202 landmark 2']);
  });
});


describe('series attribution', () => {
  const documentOf = (dataset, evidence) => ({
    SeriesInstanceUID: dataset.SeriesInstanceUID, StudyInstanceUID: STUDY,
    evidence: evidence || { [P.SeriesInstanceUID]: ['2.25.1003'], [S.SeriesInstanceUID]: ['2.25.45202'] },
  });
  const patientSet = overrides => ({ domain: 'patient', frameOfReferenceUID: P_FOR, sourceSeries: null, ...overrides });

  it('a Source-Series the document references', () => {
    const dataset = fixture('landmarks-patient');
    const store = metadataStore([P, S, reportSeries(dataset)]);
    addLandmarkSetsOf(dataset, store);
    const [entry] = getLandmarkSets();
    expect(attributionOf(entry.set, entry.document, store)).toEqual({
      seriesInstanceUID: P.SeriesInstanceUID, groupSeriesInstanceUID: P.SeriesInstanceUID,
    });
  });

  it('no Source-Series: the one referenced series with the set\'s frame; else the document\'s series, under no heading', () => {
    const dataset = fixture('landmarks-patient');
    const store = metadataStore([P, S, reportSeries(dataset)]);
    expect(attributionOf(patientSet(), documentOf(dataset), store)).toEqual({
      seriesInstanceUID: P.SeriesInstanceUID, groupSeriesInstanceUID: P.SeriesInstanceUID,
    });
    // Two referenced series share the frame
    const twin = { ...P, SeriesInstanceUID: '2.25.1009' };
    store.load(twin);
    const shared = documentOf(dataset, { [P.SeriesInstanceUID]: [], [twin.SeriesInstanceUID]: [] });
    expect(attributionOf(patientSet(), shared, store)).toEqual({ seriesInstanceUID: dataset.SeriesInstanceUID, groupSeriesInstanceUID: null });
    // An application frame
    expect(attributionOf(patientSet({ frameOfReferenceUID: '2.25.47110' }), documentOf(dataset), store))
      .toEqual({ seriesInstanceUID: dataset.SeriesInstanceUID, groupSeriesInstanceUID: null });
  });

  it('a stored Source-Series the document does not reference: the document\'s series, with a warning, never the inference', () => {
    const dataset = fixture('landmarks-patient');
    const store = metadataStore([P, S, reportSeries(dataset)]);
    expect(attributionOf(patientSet({ sourceSeries: '2.25.404' }), documentOf(dataset), store)).toEqual({
      seriesInstanceUID: dataset.SeriesInstanceUID, groupSeriesInstanceUID: null, warning: 'landmark-source-series-unknown',
    });
    // The report's own series is in the store: still no heading
    expect(store.getSeries(STUDY, dataset.SeriesInstanceUID).Modality).toBe('SR');
  });

  it('an image-domain set: the series its instance is recorded under, else the document\'s series with a warning', () => {
    const dataset = fixture('landmarks-image');
    const store = metadataStore([P, S]);
    addLandmarkSetsOf(dataset, store);
    const [first, second] = getLandmarkSets();
    expect(attributionOf(first.set, first.document, store).groupSeriesInstanceUID).toBe(P.SeriesInstanceUID);
    expect(attributionOf(second.set, second.document, store).groupSeriesInstanceUID).toBe(S.SeriesInstanceUID);
    const withoutEvidence = { ...first.document, evidence: {} };
    expect(attributionOf(first.set, withoutEvidence, store)).toEqual({
      seriesInstanceUID: dataset.SeriesInstanceUID, groupSeriesInstanceUID: null, warning: 'unresolved-image-reference',
    });
  });

  it('the warning of an unknown Source-Series is logged when the document is listed', () => {
    const dataset = fixture('landmarks-patient');
    dataset.CurrentRequestedProcedureEvidenceSequence = [];
    addLandmarkSetsOf(dataset, metadataStore([P]));
    const [, warnings] = mockLog.warn.mock.calls.find(([message]) => /not read as written/.test(message));
    expect(warnings).toEqual(['landmark-source-series-unknown 2.25.47201']);
  });
});


describe('request budget', () => {
  it('listing, placement and attribution read the loaded metadata only', () => {
    const store = metadataStore([P, S]);
    ['landmarks-patient', 'landmarks-image', 'point-collection-legacy'].forEach(topic => addLandmarkSetsOf(fixture(topic), store));
    getLandmarkSets().forEach((entry) => {
      placementOf(entry.set, store);
      attributionOf(entry.set, entry.document, store);
    });
    expect(global.fetch).not.toHaveBeenCalled();
    const used = Object.keys(store).filter(key => typeof store[key] === 'function' && store[key].mock && store[key].mock.calls.length);
    expect(used.sort()).toEqual(['getSeries', 'getStudy', 'getStudyInstanceUIDs']);
  });
});


describe('image series and display sets', () => {
  const SPECTROSCOPY = '1.2.840.10008.5.1.4.1.1.4.2';

  it('a series without an image instance neither places a set nor heads its group', () => {
    const spectroscopy = { SeriesInstanceUID: '2.25.1002', Modality: 'MR',
      instances: [{ SOPInstanceUID: '2.25.1003', SOPClassUID: SPECTROSCOPY, FrameOfReferenceUID: P_FOR, Modality: 'MR' }] };
    const dataset = fixture('landmarks-patient');
    const store = metadataStore([spectroscopy]);
    addLandmarkSetsOf(dataset, store);
    const [entry] = getLandmarkSets();
    expect(placementOf(entry.set, store).placed).toBe(false);
    // Its stored source series: attributed, but no image-series heading
    expect(attributionOf(entry.set, entry.document, store)).toEqual({ seriesInstanceUID: '2.25.1002', groupSeriesInstanceUID: null });

    // The control: an MR image of the same series
    store.unload('2.25.1002');
    store.load(P);
    expect(placementOf(entry.set, store).placed).toBe(true);
    expect(attributionOf(entry.set, entry.document, store).groupSeriesInstanceUID).toBe('2.25.1002');
  });

  it('an image-domain set is placed only while a display set shows its image', () => {
    const store = metadataStore([P, S]);
    addLandmarkSetsOf(fixture('landmarks-image'), store);
    const [first] = getLandmarkSets();
    expect(placementOf(first.set, store, [{ SeriesInstanceUID: S.SeriesInstanceUID }]).placed).toBe(false);
    expect(placementOf(first.set, store, [{ SeriesInstanceUID: P.SeriesInstanceUID }]).placed).toBe(true);
  });

  it('reads the cached metadata of the referenced image to tell a tiled one', () => {
    const dataset = fixture('landmarks-image');
    // The fixture's coordinates carry FRAME: one written without it, on a tiled image, is not read
    const group = dataset.ContentSequence.find(item => item.ConceptNameCodeSequence[0].CodeValue === '126010').ContentSequence[0];
    group.ContentSequence.filter(item => item.ValueType === 'CODE' && item.ConceptNameCodeSequence[0].CodeValue === 'Sonador-Landmark')
      .slice(0, 1).forEach((item) => { delete item.ContentSequence[0].PixelOriginInterpretation; });
    const tiled = { ...P, instances: [{ ...P.instances[0], SOPClassUID: '1.2.840.10008.5.1.4.1.1.77.1.6', TotalPixelMatrixColumns: 4096 }] };
    addLandmarkSetsOf(dataset, metadataStore([tiled]));
    expect(getLandmarkSets()[0].set.landmarks.map(landmark => landmark.point)).toEqual([[30.25, 40], [5, 6]]);
  });
});
