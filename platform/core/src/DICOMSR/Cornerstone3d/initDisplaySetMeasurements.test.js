// SR display sets link their measurements to images the way the OHIF v3 SR handler does: to the
// display sets known at load, to display sets registered later, and on request by a parser that
// holds the study's image display sets. Loading is idempotent.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { codeValues: { CORNERSTONEFREETEXT: 'CST' } }, MeasurementReport: {} } },
}), { virtual: true });
jest.mock('../../utils', () => ({ __esModule: true, default: { sortStudyInstances: () => {} } }));
jest.mock('../../utils/sopClassDictionary', () => ({
  sopClassDictionary: { BasicTextSR: '1', EnhancedSR: '2', ComprehensiveSR: '3', Comprehensive3DSR: '4' },
}));
jest.mock('../../classes', () => {
  class ImageSet {}
  return {
    __esModule: true,
    default: {
      ImageSet,
      Cornerstone3dMetadataProvider: {
        getUIDsFromImageID: imageId => {
          const [, SOPInstanceUID] = imageId.split(':');
          return { SOPInstanceUID, frameNumber: undefined };
        },
      },
    },
  };
});
jest.mock('../../measurements', () => ({
  __esModule: true,
  default: {
    Enums: {
      CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'c3d', CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '1',
      Cornerstone3D: { sr: { measurementReport: { codeValueMatch: () => false } } },
    },
    SREnums: {
      DCMSR_FINDING: {},
      CodeNameCodeSequenceValues: {
        ImagingMeasurements: '126010', MeasurementGroup: '125007', TrackingUniqueIdentifier: '112040',
        TrackingIdentifier: '112039', Finding: '121071', FindingSite: 'G-C0E3', FindingSiteSCT: '363698007',
        ImagingMeasurementReport: '126000', ImageLibrary: '111028', ImageLibraryGroup: '126200',
      },
      CodingSchemeDesignators: { SCT: 'SCT', SRT: 'SRT', CornerstoneCodeSchemes: ['CST'] },
    },
  },
}));
jest.mock('../../types', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DicomMetadataStore', () => ({
  __esModule: true,
  default: {
    getSeries: () => ({ instances: [] }),
    getInstance: (study, series, sop) => ({ imageId: `img:${sop}` }),
  },
}));
jest.mock('../../services/DisplaySetService', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/isRehydratable', () => ({ __esModule: true, default: () => true }));

const { linkMeasurementsToDisplaySets } = require('./initDisplaySetMeasurements');
const classes = require('../../classes').default;

// A minimal service: active display sets plus a DISPLAY_SETS_ADDED subscription list
function createDisplaySetService(active = []) {
  const listeners = [];
  return {
    EVENTS: { DISPLAY_SETS_ADDED: 'added' },
    activeDisplaySets: active,
    getDisplaySetByUID: () => undefined,
    subscribe: jest.fn((event, listener) => {
      listeners.push(listener);
      return { unsubscribe: jest.fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
    }),
    add(displaySets) {
      this.activeDisplaySets.push(...displaySets);
      listeners.forEach(listener => listener({ displaySetsAdded: displaySets }));
    },
    listenerCount: () => listeners.length,
  };
}

const measurement = sop => ({
  loaded: false, labels: [], coords: [{ ReferencedSOPSequence: { ReferencedSOPInstanceUID: sop } }],
});

// An image display set the way the service holds one: a real ImageSet whose images carry SOPs
function imageDisplaySet(uid, sops) {
  const ds = new classes.ImageSet();
  Object.assign(ds, { displaySetInstanceUID: uid, Modality: 'CT', images: sops.map(sop => ({ SOPInstanceUID: sop })) });
  return ds;
}

// A loaded SR display set (the parse step is exercised through load() below)
function srDisplaySet(sops) {
  return { isLoaded: true, measurements: sops.map(measurement) };
}

const servicesFor = displaySetService => ({
  services: { displaySetService, MeasurementService: { getSourceMappings: () => [] }, customizationService: { getCustomization: () => undefined } },
});

describe('linkMeasurementsToDisplaySets', () => {
  it('links measurements to the images of the given display sets and reports what is left', () => {
    const sr = srDisplaySet(['sopA', 'sopB']);
    const services = servicesFor(createDisplaySetService());

    expect(linkMeasurementsToDisplaySets(sr, [imageDisplaySet('ds1', ['sopA'])], services)).toBe(1);

    expect(sr.measurements[0]).toMatchObject({ loaded: true, imageId: 'img:sopA', displaySetInstanceUID: 'ds1', ReferencedSOPInstanceUID: 'sopA', frameNumber: 1 });
    expect(sr.measurements[1].loaded).toBe(false);
  });

  it('scans image series only: a derived display set carrying instances is skipped', () => {
    const sr = srDisplaySet(['sopA']);
    const model = { displaySetInstanceUID: 'm3d', Modality: 'M3D', images: [{ SOPInstanceUID: 'sopA' }] };

    expect(linkMeasurementsToDisplaySets(sr, [model], servicesFor(createDisplaySetService()))).toBe(1);
    expect(sr.measurements[0].loaded).toBe(false);
  });

  it('a display set whose instances cannot be resolved does not stop the others', () => {
    const sr = srDisplaySet(['sopA']);
    const DicomMetadataStore = require('../../services/DicomMetadataStore').default;
    const getInstance = DicomMetadataStore.getInstance;
    DicomMetadataStore.getInstance = (study, series, sop) => (sop === 'missing' ? undefined : getInstance(study, series, sop));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const remaining = linkMeasurementsToDisplaySets(sr,
      [imageDisplaySet('broken', ['missing']), imageDisplaySet('ds1', ['sopA'])], servicesFor(createDisplaySetService()));

    DicomMetadataStore.getInstance = getInstance;
    warn.mockRestore();
    expect(remaining).toBe(0);
    expect(sr.measurements[0].imageId).toBe('img:sopA');
  });

  it('ignores an unloaded report', () => {
    const sr = srDisplaySet(['sopA']);

    const unloaded = { isLoaded: false, measurements: [measurement('sopA')] };
    expect(linkMeasurementsToDisplaySets(unloaded, [imageDisplaySet('ds1', ['sopA'])], servicesFor(createDisplaySetService()))).toBe(1);
    expect(unloaded.measurements[0].loaded).toBe(false);
  });
});

describe('SR display set load', () => {
  // The display set's load() is created by _getDisplaySetsFromSeries; drive it through the module's
  // default export with a series whose report is already naturalized
  const { default: initDisplaySetMeasurements } = require('./initDisplaySetMeasurements');

  function loadableSr(sops, displaySetService) {
    const DicomMetadataStore = require('../../services/DicomMetadataStore').default;
    const instance = {
      StudyInstanceUID: 'study', SeriesInstanceUID: 'sr', SOPInstanceUID: 'srsop', SOPClassUID: '3',
      ConceptNameCodeSequence: { CodeValue: '126000' },
      ContentSequence: [{
        ConceptNameCodeSequence: { CodeValue: '126010' },
        ContentSequence: sops.map((sop, i) => ({
          ConceptNameCodeSequence: { CodeValue: '125007' },
          ContentSequence: [
            { ConceptNameCodeSequence: { CodeValue: '112040' }, ValueType: 'UIDREF', UID: `track-${i}` },
            { ConceptNameCodeSequence: { CodeValue: '112039' }, ValueType: 'TEXT', TextValue: `Tag ${i}` },
            { ConceptNameCodeSequence: { CodeValue: 'x' }, ValueType: 'SCOORD', GraphicType: 'POINT', GraphicData: [1, 1],
              ContentSequence: { ReferencedSOPSequence: { ReferencedSOPInstanceUID: sop } } },
          ],
        })),
      }],
    };
    DicomMetadataStore.getSeries = () => ({ instances: [instance] });
    const services = servicesFor(displaySetService);
    const ds = initDisplaySetMeasurements({ displaySetInstanceUID: 'srds', StudyInstanceUID: 'study', SeriesInstanceUID: 'sr' }, services);
    return { ds, services };
  }

  it('places a series tag on the image referenced by its finding, even when a description finding without a reference comes first', async () => {
    const service = createDisplaySetService([imageDisplaySet('ds1', ['sopA'])]);
    const DicomMetadataStore = require('../../services/DicomMetadataStore').default;
    const finding = (contentSequence) => ({
      ConceptNameCodeSequence: { CodeValue: '121071', CodingSchemeDesignator: 'DCM' }, ValueType: 'CODE',
      ConceptCodeSequence: [{ CodeValue: 'T1', CodeMeaning: 'Tag' }],
      ...(contentSequence ? { ContentSequence: contentSequence } : {}),
    });
    const group = (items) => ({ ConceptNameCodeSequence: { CodeValue: '125007' }, ContentSequence: items });
    const tracking = [
      { ConceptNameCodeSequence: { CodeValue: '112040' }, ValueType: 'UIDREF', UID: 'track-0' },
      { ConceptNameCodeSequence: { CodeValue: '112039' }, ValueType: 'TEXT', TextValue: 'cornerstoneTools@^4.0.0:DICOMSRSeriesTagTool' },
    ];
    // Two groups share the tracking UID: the description (a finding with no image) and the tag
    // whose finding references the image through an array-shaped content sequence
    const instance = {
      StudyInstanceUID: 'study', SeriesInstanceUID: 'sr', SOPInstanceUID: 'srsop', SOPClassUID: '3',
      ConceptNameCodeSequence: { CodeValue: '126000' },
      ContentSequence: [{
        ConceptNameCodeSequence: { CodeValue: '126010' },
        ContentSequence: [
          group([...tracking, finding(undefined)]),
          group([...tracking, finding([{ ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: 'sopA' }] }])]),
        ],
      }],
    };
    DicomMetadataStore.getSeries = () => ({ instances: [instance] });
    const measurements = require('../../measurements').default;
    measurements.Enums.Cornerstone3D.sr.measurementReport.codeValueMatch =
      (group, code) => group?.ConceptNameCodeSequence?.CodeValue === '121071';

    const ds = initDisplaySetMeasurements({ displaySetInstanceUID: 'srds2', StudyInstanceUID: 'study', SeriesInstanceUID: 'sr' }, servicesFor(service));
    await ds.load();

    expect(ds.measurements).toHaveLength(1);
    expect(ds.measurements[0]).toMatchObject({ loaded: true, imageId: 'img:sopA', ReferencedSOPInstanceUID: 'sopA' });
    measurements.Enums.Cornerstone3D.sr.measurementReport.codeValueMatch = () => false;
  });

  it('parses once, links what is known, and keeps linking as display sets are added', async () => {
    const service = createDisplaySetService([imageDisplaySet('ds1', ['sopA'])]);
    const { ds } = loadableSr(['sopA', 'sopB'], service);

    await ds.load();
    expect(ds.isLoaded).toBe(true);
    expect(ds.measurements.map(m => m.loaded)).toEqual([true, false]);
    expect(service.listenerCount()).toBe(1);

    service.add([imageDisplaySet('ds2', ['sopB'])]);
    expect(ds.measurements.map(m => m.imageId)).toEqual(['img:sopA', 'img:sopB']);
    expect(service.listenerCount()).toBe(0);   // done: the subscription is released
  });

  it('loading again keeps the links instead of re-parsing', async () => {
    const service = createDisplaySetService([imageDisplaySet('ds1', ['sopA'])]);
    const { ds } = loadableSr(['sopA'], service);

    await ds.load();
    const measurements = ds.measurements;
    await ds.load();
    expect(ds.measurements).toBe(measurements);
    expect(ds.measurements[0].loaded).toBe(true);
    expect(service.subscribe).not.toHaveBeenCalled();
  });

  it('is reused from the service once loaded rather than re-created', async () => {
    const service = createDisplaySetService([]);
    const { ds, services } = loadableSr(['sopA'], service);
    await ds.load();
    service.getDisplaySetByUID = uid => (uid === 'srds' ? ds : undefined);

    const again = initDisplaySetMeasurements({ displaySetInstanceUID: 'srds', StudyInstanceUID: 'study', SeriesInstanceUID: 'sr' }, services);
    expect(again).toBe(ds);
  });
});
