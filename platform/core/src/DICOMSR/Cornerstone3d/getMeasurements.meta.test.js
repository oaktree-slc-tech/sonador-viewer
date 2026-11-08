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
