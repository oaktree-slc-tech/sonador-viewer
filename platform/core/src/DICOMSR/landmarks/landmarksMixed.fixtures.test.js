// sonador-io.landmarks-mixed (a landmark set beside a Series Tag, a Length and an arrow) through the
// production readers: the measurement extractor and the Cornerstone3D hydration with the library
// adapters read the Series Tag, the Length and the arrow as before and never the set; the set is
// listed once; the document is never a save parent. Only @cornerstonejs/core is replaced, by a
// synthetic image.

import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import { data as dcmjsData } from 'dcmjs';

const mockImagePlanes = {};
jest.mock('@cornerstonejs/core', () => {
  const get = (type, imageId) => (type === 'imagePlaneModule' ? mockImagePlanes[imageId] : undefined);
  const plane = (imageId) => {
    const module = get('imagePlaneModule', imageId);
    if (!module) {
      throw new Error(`No imagePlaneModule found for imageId: ${imageId}`);
    }
    return module;
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    metaData: { get, addProvider: () => {} },
    utilities: {
      imageToWorldCoords: (imageId, [x, y]) => {
        const m = plane(imageId);
        return [0, 1, 2].map(i => m.imagePositionPatient[i]
          + m.rowCosines[i] * m.rowPixelSpacing * (x - 0.5) + m.columnCosines[i] * m.columnPixelSpacing * (y - 0.5));
      },
      worldToImageCoords: (imageId, point) => {
        const m = plane(imageId);
        const offset = point.map((value, i) => value - m.imagePositionPatient[i]);
        return [dot(offset, m.rowCosines) / m.rowPixelSpacing + 0.5, dot(offset, m.columnCosines) / m.columnPixelSpacing + 0.5];
      },
      updatePlaneRestriction: () => {},
    },
    Enums: { MetadataModules: {} },
    cache: {},
  };
}, { virtual: true });

jest.mock('@cornerstonejs/adapters', () => {
  const adapters = '../../../../../node_modules/@cornerstonejs/adapters/dist/esm/adapters';
  const load = file => jest.requireActual(`${adapters}/${file}`).default;
  return {
    adaptersSR: {
      Cornerstone: {
        MeasurementReport: load('Cornerstone/MeasurementReport.js'), Length: load('Cornerstone/Length.js'),
        ArrowAnnotate: load('Cornerstone/ArrowAnnotate.js'),
      },
      Cornerstone3D: {
        MeasurementReport: load('Cornerstone3D/MeasurementReport.js'),
        BaseAdapter3D: load('Cornerstone3D/BaseAdapter3D.js'),
        Angle: load('Cornerstone3D/Angle.js'),
        CobbAngle: load('Cornerstone3D/CobbAngle.js'),
        Length: load('Cornerstone3D/Length.js'),
        CircleROI: load('Cornerstone3D/CircleROI.js'),
        Bidirectional: load('Cornerstone3D/Bidirectional.js'),
        ArrowAnnotate: load('Cornerstone3D/ArrowAnnotate.js'),
        CodeScheme: load('Cornerstone3D/CodingScheme.js'),
      },
    },
    helpers: {
      toArray: x => (Array.isArray(x) ? x : x !== undefined ? [x] : []),
      codeMeaningEquals: meaning => contentItem => contentItem.ConceptNameCodeSequence.CodeMeaning === meaning,
    },
  };
}, { virtual: true });
jest.mock('../../measurements/enums', () => {
  const Enums = {
    SREnums: jest.requireActual('../enums').Enums,
    SERVICE_EVENTS: { MEASUREMENTS_DATASYNC: 'datasync' },
    EVENTS: {},
    Cornerstone3D: { sr: {} },
  };
  Object.defineProperty(Enums.Cornerstone3D.sr, 'measurementReport', {
    get: () => jest.requireActual('../Cornerstone3d/MeasurementReport').default,
  });
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../../measurements/classes', () => ({
  MeasurementApi: {
    Instance: { measurementService: { _broadcastEvent: () => {} } },
    _unpackMeasurementData: measurement => ({
      measurementMeta: measurement.metadata || measurement,
      measurementData: measurement.data || measurement.measurementData || measurement,
    }),
  },
}));
// The display set dependencies of the measurement extractor
jest.mock('../../utils', () => ({ __esModule: true, default: { sortStudyInstances: () => {} } }));
jest.mock('../../classes', () => ({ __esModule: true, default: { ImageSet: class {}, Cornerstone3dMetadataProvider: {} } }));
jest.mock('../../measurements', () => {
  const { Enums: SREnums } = jest.requireActual('../enums');
  return { __esModule: true, default: { Enums: { Cornerstone3D: { sr: { measurementReport: { codeValueMatch: () => false } } } }, SREnums } };
});
jest.mock('../../types', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DicomMetadataStore', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DisplaySetService', () => ({ __esModule: true, default: {} }));
jest.mock('../Cornerstone3d/utils/isRehydratable', () => ({ __esModule: true, default: () => true }));

import { metaData as c3dMetaData } from '@cornerstonejs/core';
import { readDicomFile } from '../../utils/dicomCharacterSet';
import { getMeasurements } from '../Cornerstone3d/initDisplaySetMeasurements';
import { extendedMetaOptions } from '../utils/propertyParent';
import { parseExtendedMeta } from '../utils/dcmsrExtendedMeta';
import { parseDisplayAttributes } from '../utils/dcmsrDisplayAttributes';
import { clearHydratedReports, registerHydratedReport, saveParent } from '../utils/srDocument';
import { asArray, conceptNameValue } from '../utils/codedConcept';
import { addLandmarkSetsOf, getLandmarkSets } from './landmarkSetStore';

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};

// The image the Series Tag references: axial at z = 0 in frame P
const IMAGE = { SOPInstanceUID: '2.25.1003', imageId: 'synthetic:2.25.1003' };
mockImagePlanes[IMAGE.imageId] = {
  imagePositionPatient: [0.5, 0.5, 0], rowCosines: [1, 0, 0], columnCosines: [0, 1, 0],
  rowPixelSpacing: 1, columnPixelSpacing: 1, frameOfReferenceUID: '2.25.45100',
};

let MeasurementReport3D;
beforeAll(() => {
  require('../Cornerstone3d/adapters');
  MeasurementReport3D = require('../Cornerstone3d/MeasurementReport').default;
});
beforeEach(() => {
  clearHydratedReports();
  ['log', 'debug', 'info', 'warn'].forEach(level => jest.spyOn(console, level).mockImplementation(() => {}));
});
afterEach(() => jest.restoreAllMocks());

function hydrate(dataset) {
  return MeasurementReport3D.generateToolState(dataset, { [IMAGE.SOPInstanceUID]: IMAGE.imageId }, c3dMetaData, undefined, {
    onContentItemParse: (toolType, annotation, srItem) => {
      const { propertyParent, textField } = extendedMetaOptions(toolType);
      parseExtendedMeta(srItem, annotation, { propertyParent, textField });
      parseDisplayAttributes(srItem, annotation, { propertyParent });
    },
  });
}

const tool = trackingIdentifier => trackingIdentifier.slice(trackingIdentifier.lastIndexOf(':') + 1);


describe('sonador-io.landmarks-mixed', () => {
  it('the measurement extractor reads the Series Tag, the arrow and the Length, and not the set', () => {
    const measurements = getMeasurements(fixture('landmarks-mixed').ContentSequence);
    expect(measurements.map(m => [tool(m.TrackingIdentifier), m.TrackingUniqueIdentifier])).toEqual([
      ['DICOMSRSeriesTagTool', '2.25.47301'], ['ArrowAnnotate', '2.25.47303'], ['Length', '2.25.47302'],
    ]);
  });

  it('hydration reads the Series Tag, the Length and the arrow as before, and no set', () => {
    const byType = hydrate(fixture('landmarks-mixed'));
    const uids = _.mapValues(byType, states => states.map(state => state.TrackingUniqueIdentifier));
    expect(uids).toEqual({ DICOMSRSeriesTagTool: ['2.25.47301'], ArrowAnnotate: ['2.25.47303'], Length: ['2.25.47302'] });
    expect(byType.ArrowAnnotate[0].annotation.data.text).toBe('Arrow beside the set');
  });

  it('the same three without the landmark group: the set changes nothing else', () => {
    const dataset = fixture('landmarks-mixed');
    const container = asArray(dataset.ContentSequence).find(item => conceptNameValue(item) === '126010');
    container.ContentSequence = asArray(container.ContentSequence).filter(group =>
      !asArray(group.ContentSequence).some(item => item.TextValue === 'cornerstoneTools@^4.0.0:SonadorLandmarkSet'));
    expect(_.mapValues(hydrate(dataset), states => states.length)).toEqual(_.mapValues(hydrate(fixture('landmarks-mixed')), states => states.length));
  });

  it('lists one landmark set, once however often the document is processed', () => {
    const dataset = fixture('landmarks-mixed');
    addLandmarkSetsOf(dataset, undefined);
    addLandmarkSetsOf(fixture('landmarks-mixed'), undefined);
    expect(getLandmarkSets().map(entry => [entry.set.name, entry.set.landmarks.length, entry.document.kind])).toEqual([
      ['Pelvic landmarks', 10, 'exchange'],
    ]);
  });

  it('is not a save parent; the same document without its set is', () => {
    const dataset = fixture('landmarks-mixed');
    registerHydratedReport(dataset);
    expect(saveParent(dataset.StudyInstanceUID)).toBeNull();

    const container = asArray(dataset.ContentSequence).find(item => conceptNameValue(item) === '126010');
    container.ContentSequence = asArray(container.ContentSequence).filter(group =>
      !asArray(group.ContentSequence).some(item => item.TextValue === 'cornerstoneTools@^4.0.0:SonadorLandmarkSet'));
    registerHydratedReport(dataset);
    expect(saveParent(dataset.StudyInstanceUID)).toMatchObject({ SOPInstanceUID: dataset.SOPInstanceUID });
  });

  it('a document with a legacy point group is not a save parent either', () => {
    const dataset = fixture('point-collection-legacy');
    // As an exchange document: the application root is never a parent on its own
    dataset.ConceptNameCodeSequence = [{ CodeValue: '126000', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Imaging Measurement Report' }];
    registerHydratedReport(dataset);
    expect(saveParent(dataset.StudyInstanceUID)).toBeNull();
  });
});
