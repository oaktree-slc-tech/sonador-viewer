// The SR display set's measurements carry the extended meta (description, text, location) and the
// display attributes, in the shape the read-only display and the Measurements panel read. The
// layouts are those the viewer has written: group-level HAS CONCEPT MOD items (legacy Length
// reports), and per-measurement properties under the NUM's Finding.

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { codeValues: { CORNERSTONEFREETEXT: 'CST' } }, MeasurementReport: {} } },
}), { virtual: true });
jest.mock('@cornerstonejs/core', () => ({ metaData: { get: () => undefined } }), { virtual: true });
jest.mock('../../utils', () => ({ __esModule: true, default: { sortStudyInstances: () => {} } }));
jest.mock('../../classes', () => ({ __esModule: true, default: { ImageSet: class {}, Cornerstone3dMetadataProvider: {} } }));
jest.mock('../../measurements', () => {
  const { Enums: SREnums } = jest.requireActual('../enums');
  return {
    __esModule: true,
    default: {
      Enums: { Cornerstone3D: { sr: { measurementReport: { codeValueMatch: () => false } } } },
      SREnums,
    },
  };
});
jest.mock('../../measurements/classes', () => ({ MeasurementApi: { Instance: {} } }));
jest.mock('../../measurements/enums', () => {
  const Enums = { SREnums: jest.requireActual('../enums').Enums, EVENTS: {}, Cornerstone3D: { sr: {} } };
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../../types', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DicomMetadataStore', () => ({ __esModule: true, default: {} }));
jest.mock('../../services/DisplaySetService', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/isRehydratable', () => ({ __esModule: true, default: () => true }));

// Read-only placement, for the coded-finding case: the classic representation and the
// Cornerstone3D annotation are recorded, the measurement API holds nothing
jest.mock('../../log', () => ({ __esModule: true, default: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));
jest.mock('../../measurements/classes/MeasurementApi', () => ({
  __esModule: true,
  default: { Instance: { getMeasurementByTrackingUid: () => undefined, syncMeasurementsAndToolData: () => {} } },
}));
const mockPlaced = [];
jest.mock('../SCOORD3D/utils/addMeasurement', () => ({
  __esModule: true, default: (measurement, imageId) => mockPlaced.push({ uid: measurement.TrackingUniqueIdentifier, imageId }),
}));
jest.mock('../readOnly/srDisplayAnnotations', () => ({ addSRDisplayAnnotation: () => null, renderSRDisplayAnnotations: () => {} }));

import { getMeasurements } from './initDisplaySetMeasurements';
import addReadOnlyMeasurements from '../readOnly/addReadOnlyMeasurements';

const dcm = (CodeValue, CodeMeaning) => [{ CodeValue, CodingSchemeDesignator: 'DCM', CodeMeaning }];
const sonador = (CodeValue) => [{ CodeValue, CodingSchemeDesignator: 'Sonador-SR', CodeMeaning: CodeValue }];
const text = (RelationshipType, code, TextValue) => ({ RelationshipType, ValueType: 'TEXT', ConceptNameCodeSequence: sonador(code), TextValue });

// A Length as the legacy writer stores it: NUM inferred from a SCOORD, meta at group level
const legacyLength = (uid, description, location) => ({
  RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: dcm('125007', 'Measurement Group'),
  ContentSequence: [
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'TEXT', ConceptNameCodeSequence: dcm('112039', 'Tracking Identifier'),
      TextValue: 'cornerstoneTools@^4.0.0:Length' },
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'UIDREF', ConceptNameCodeSequence: dcm('112040', 'Tracking Unique Identifier'), UID: uid },
    { RelationshipType: 'CONTAINS', ValueType: 'NUM', ConceptNameCodeSequence: [{ CodeValue: 'G-D7FE', CodingSchemeDesignator: 'SRT', CodeMeaning: 'Length' }],
      MeasuredValueSequence: [{ NumericValue: 41.5, MeasurementUnitsCodeSequence: [{ CodeValue: 'mm', CodingSchemeDesignator: 'UCUM' }] }],
      ContentSequence: [{
        RelationshipType: 'INFERRED FROM', ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [22.8, 133.3, 60.7, 140.2],
        ContentSequence: [{ RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '2.25.900' }] }],
      }],
    },
    text('HAS CONCEPT MOD', 'Sonador-Measurement.Description', description),
    text('HAS CONCEPT MOD', 'Sonador-Measurement.Location', location),
  ],
});

const report = groups => [{
  RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: dcm('126010', 'Imaging Measurements'),
  ContentSequence: groups,
}];

describe('SR display set measurements', () => {
  it('carry the description and location of a legacy Length (group-level meta)', () => {
    const [patella, femur] = getMeasurements(report([
      legacyLength('2.25.1', 'MRI: Patella', 'Bone'),
      legacyLength('2.25.2', 'MRI: Femur', 'Bone'),
    ]));

    expect(patella).toMatchObject({
      TrackingUniqueIdentifier: '2.25.1', description: 'MRI: Patella', metadata: { location: 'Bone' },
    });
    expect(patella.coords[0]).toMatchObject({
      GraphicType: 'POLYLINE', ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.900' },
    });
    expect(femur).toMatchObject({ description: 'MRI: Femur', metadata: { location: 'Bone' } });
  });

  it('carry the free text and the display colours', () => {
    const group = legacyLength('2.25.3', 'CT: Tibia', 'Bone');
    group.ContentSequence.push(text('HAS CONCEPT MOD', 'Sonador-Measurement.Text', 'Proximal third'));
    group.ContentSequence.push({
      RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: sonador('Sonador-DisplayAttributes'),
      ContentSequence: [{
        RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: sonador('Sonador-DisplayAttributes.Color'),
        ContentSequence: [text('CONTAINS', 'Sonador-DisplayAttributes.Color.Background', '34952\\53040\\5911')],
      }],
    });

    const [measurement] = getMeasurements(report([group]));
    expect(measurement.metadata).toMatchObject({ location: 'Bone', text: 'Proximal third' });
    expect(measurement.displayAttributes.Color.Background).toMatch(/^#[0-9a-f]{6}$/i);
  });
});


// A finding from a tool the viewer does not support: coded content and an image, no value
const codedFinding = uid => ({
  RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: dcm('125007', 'Measurement Group'),
  ContentSequence: [
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'TEXT', ConceptNameCodeSequence: dcm('112039', 'Tracking Identifier'),
      TextValue: 'vendor@1.0:Observation' },
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'UIDREF', ConceptNameCodeSequence: dcm('112040', 'Tracking Unique Identifier'), UID: uid },
    { RelationshipType: 'CONTAINS', ValueType: 'CODE', ConceptNameCodeSequence: dcm('121071', 'Finding'),
      ConceptCodeSequence: [{ CodeValue: 'EX-1', CodingSchemeDesignator: '99VENDOR', CodeMeaning: 'Example finding' }] },
    { RelationshipType: 'CONTAINS', ValueType: 'IMAGE', ReferencedSOPSequence: [{ ReferencedSOPInstanceUID: '2.25.900' }] },
  ],
});

describe('coded findings and incomplete groups', () => {
  it('label a coded finding with its codes, and list them on its image when displayed read-only', () => {
    const [finding] = getMeasurements(report([codedFinding('2.25.40')]));
    expect(finding.labels).toEqual([{
      label: 'Finding', labelCodingSchemeDesignator: 'DCM', value: 'Example finding', valueCodingSchemeDesignator: '99VENDOR',
    }]);

    const ct = {
      displaySetInstanceUID: 'ct', SRLabels: [],
      images: [{ getData: () => ({ metadata: { SOPInstanceUID: '2.25.900' } }) }],
    };
    addReadOnlyMeasurements({
      srDisplaySets: [{ measurements: [finding] }],
      imageDisplaySets: [ct],
      imageIds: { sopInstanceUIDToImageId: { '2.25.900': 'wadors:image' }, imageIdsForToolState: {} },
    });

    expect(mockPlaced).toEqual([{ uid: '2.25.40', imageId: 'wadors:image' }]);
    expect(ct.SRLabels).toEqual([{
      ReferencedSOPInstanceUID: '2.25.900',
      labels: expect.objectContaining({
        label: 'Finding', value: 'Example finding', labelCodingSchemeDesignator: 'DCM', valueCodingSchemeDesignator: '99VENDOR', visible: true,
      }),
    }]);
  });

  it('skip a group without a tracking UID and keep its valid siblings', () => {
    const orphan = legacyLength('ignored', 'Orphan', 'Bone');
    orphan.ContentSequence = orphan.ContentSequence.filter(item => item.ValueType !== 'UIDREF');

    const measurements = getMeasurements(report([orphan, legacyLength('2.25.5', 'CT: Femur', 'Bone')]));
    expect(measurements.map(m => m.TrackingUniqueIdentifier)).toEqual(['2.25.5']);
  });
});


describe('Angle and Cobb angle measurements for the read-only display', () => {
  const fs = require('fs');
  const path = require('path');
  const { data: dcmjsData } = require('dcmjs');
  const contentOf = file => {
    const buffer = fs.readFileSync(path.join(__dirname, '..', '__fixtures__', file));
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return dcmjsData.DicomMetaDictionary.naturalizeDataset(dcmjsData.DicomMessage.readFile(arrayBuffer).dict).ContentSequence;
  };

  it('draw a Cobb angle as its two lines, each on the referenced image', () => {
    const [cobbAngle] = getMeasurements(contentOf('sonador-viewer.cobb-angle-image.2026-1108.dcm'));
    expect(cobbAngle.TrackingIdentifier).toBe('cornerstoneTools@^4.0.0:CobbAngle');
    expect(cobbAngle.coords).toHaveLength(2);
    cobbAngle.coords.forEach(coord => {
      expect(coord).toMatchObject({ GraphicType: 'POLYLINE', ValueType: 'SCOORD' });
      expect(coord.GraphicData).toHaveLength(4);
      expect(coord.ReferencedSOPSequence).toBeDefined();
    });
  });

  it('draw an Angle as its polyline (p1, vertex, vertex, p3)', () => {
    const [angle] = getMeasurements(contentOf('sonador-viewer.angle-image.2026-1108.dcm'));
    expect(angle.coords).toHaveLength(1);
    expect(angle.coords[0].GraphicData).toHaveLength(8);
  });
});

describe('displayCoordsOf', () => {
  const { displayCoordsOf } = jest.requireActual('../utils/angleGeometry');
  const ref = { ReferencedSOPSequence: { ReferencedSOPInstanceUID: '2.25.900' } };

  it('splits a Cobb angle polyline of either prefix and coordinate domain, and nothing else', () => {
    const image = { ValueType: 'SCOORD', GraphicType: 'POLYLINE', GraphicData: [1, 2, 3, 4, 5, 6, 7, 8], ...ref };
    expect(displayCoordsOf('Cornerstone3DTools@^0.1.0:CobbAngle', [image]).map(c => c.GraphicData)).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]]);
    const patient = { ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] };
    expect(displayCoordsOf('cornerstoneTools@^4.0.0:CobbAngle', [patient]).map(c => c.GraphicData))
      .toEqual([[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]]);

    expect(displayCoordsOf('cornerstoneTools@^4.0.0:Angle', [image])).toEqual([image]);
    expect(displayCoordsOf('cornerstoneTools@^4.0.0:Length', [image])).toEqual([image]);
    const short = { ...image, GraphicData: [1, 2, 3, 4] };
    expect(displayCoordsOf('cornerstoneTools@^4.0.0:CobbAngle', [short])).toEqual([short]);
    expect(displayCoordsOf(undefined, [image])).toEqual([image]);
  });
});


describe('properties under the NUM item', () => {
  const num = (code, value, children) => ({
    RelationshipType: 'CONTAINS', ValueType: 'NUM', ConceptNameCodeSequence: [{ CodeValue: code, CodingSchemeDesignator: 'SCT', CodeMeaning: code }],
    MeasuredValueSequence: [{ NumericValue: value, MeasurementUnitsCodeSequence: [{ CodeValue: 'mm', CodingSchemeDesignator: 'UCUM' }] }],
    ContentSequence: children,
  });
  const scoord3d = (GraphicData, name) => ({
    RelationshipType: name ? 'HAS PROPERTIES' : 'INFERRED FROM', ValueType: 'SCOORD3D', GraphicType: 'POLYLINE', GraphicData,
    ReferencedFrameOfReferenceUID: '2.25.10', ...(name ? { ConceptNameCodeSequence: sonador(name) } : {}),
  });
  const uidref = (code, UID) => ({ RelationshipType: 'HAS PROPERTIES', ValueType: 'UIDREF', ConceptNameCodeSequence: sonador(code), UID });
  const colour = (role, lab) => text('HAS PROPERTIES', `Sonador-DisplayAttributes.Color.${role}`, lab);
  const group = (tool, uid, items) => ({
    RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: dcm('125007', 'Measurement Group'),
    ContentSequence: [
      { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'TEXT', ConceptNameCodeSequence: dcm('112039', 'Tracking Identifier'),
        TextValue: `cornerstoneTools@^4.0.0:${tool}` },
      { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'UIDREF', ConceptNameCodeSequence: dcm('112040', 'Tracking Unique Identifier'), UID: uid },
      ...items,
    ],
  });
  const finding = children => ({
    RelationshipType: 'CONTAINS', ValueType: 'CODE', ConceptNameCodeSequence: dcm('121071', 'Finding'),
    ConceptCodeSequence: [{ CodeValue: 'x', CodingSchemeDesignator: '99TEST', CodeMeaning: 'Finding' }], ContentSequence: children,
  });

  it('reads description, text, location, view, source series and colours of a Python-written Length from its NUM', () => {
    const [length] = getMeasurements(report([group('Length', '2.25.20', [num('410668003', 31.2, [
      scoord3d([0, 0, 0, 0, 31.2, 0]),
      text('HAS PROPERTIES', 'Sonador-Measurement.Description', 'Femoral neck'),
      text('HAS PROPERTIES', 'Sonador-Measurement.Text', 'CT'),
      text('HAS PROPERTIES', 'Sonador-Measurement.Location', 'Bone'),
      text('HAS PROPERTIES', 'Sonador-Measurement.View', ' sagittal '),
      uidref('Sonador-Measurement.Source-Series', '2.25.30'),
      // The flat form of older Enhanced SR reports: colour roles directly under the NUM
      colour('Border', '65535\\32768\\32768'),
    ])])]));

    expect(length.description).toBe('Femoral neck');
    expect(length.metadata).toMatchObject({ text: 'CT', location: 'Bone', views: ['sagittal'], sourceSeries: '2.25.30' });
    expect(length.displayAttributes.Color.Border).toMatch(/^#[0-9A-F]{6}$/);
    expect(length.coords).toHaveLength(1);
  });

  it('keeps an unknown View value verbatim, trimmed', () => {
    const [angle] = getMeasurements(report([group('Angle', '2.25.21', [num('285285000', 12, [
      scoord3d([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0]),
      text('HAS PROPERTIES', 'Sonador-Measurement.View', '  frog-leg lateral '),
    ])])]));
    expect(angle.metadata.views).toEqual(['frog-leg lateral']);
  });

  it("reads the NUM's properties, not the Finding's, when a group holds both", () => {
    const [length] = getMeasurements(report([group('Length', '2.25.22', [
      finding([text('HAS PROPERTIES', 'Sonador-Measurement.Description', 'Finding description')]),
      num('410668003', 10, [scoord3d([0, 0, 0, 10, 0, 0]), text('HAS PROPERTIES', 'Sonador-Measurement.Description', 'NUM description')]),
    ])]));
    expect(length.description).toBe('NUM description');
  });

  it('takes the typed properties from the first NUM that carries any, and keeps every NUM with its own children', () => {
    const unknown = { RelationshipType: 'HAS PROPERTIES', ValueType: 'TEXT', ConceptNameCodeSequence: [{ CodeValue: '99-x', CodingSchemeDesignator: '99PLAN', CodeMeaning: 'Plan item' }], TextValue: 'kept' };
    const construction = scoord3d([1, 1, 1, 2, 2, 2, 3, 3, 3], 'Sonador-Measurement.ConstructionPoints');
    const [circle] = getMeasurements(report([group('CircleROI', '2.25.23', [
      num('Area', 78.5, [construction, scoord3d([0, 0, 0, 5, 0, 0]), unknown]),
      num('Radius', 5, [scoord3d([0, 0, 0, 5, 0, 0]), text('HAS PROPERTIES', 'Sonador-Measurement.Description', 'Radius NUM')]),
    ])]));

    expect(circle.description).toBe('Radius NUM');
    // The construction points are not the geometry
    expect(circle.coords.every(coord => coord.GraphicData.length === 6)).toBe(true);
    // Each NUM keeps its children, the unknown and construction items with their own NUM
    expect(circle.numItems).toHaveLength(2);
    expect(circle.numItems[0].ContentSequence).toEqual([construction, scoord3d([0, 0, 0, 5, 0, 0]), unknown]);
    expect(circle.numItems[1].ContentSequence.map(item => item.ValueType)).toEqual(['SCOORD3D', 'TEXT']);
  });
});
