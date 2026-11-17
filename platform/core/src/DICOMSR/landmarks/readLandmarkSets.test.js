// The landmark-set reader on the Sonador IO fixtures (__fixtures__/sonador-io.landmarks-*,
// sonador-io.point-collection-legacy*) and on synthetic groups built here for the cases no fixture
// holds: two frames of one instance, a partial read, unknown and absent types, unreadable items.

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

import { readDicomFile } from '../../utils/dicomCharacterSet';
import readLandmarkSets, { LANDMARK_TYPES } from './readLandmarkSets';
import { holdsLandmarkSets, isLandmarkSetTrackingIdentifier } from './landmarkGroups';
import { landmarkColors, ownColorRoles } from './landmarkColors';

const FIXTURES = path.join(__dirname, '..', '__fixtures__');
const fixture = (topic) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, `sonador-io.${topic}.2026-1114.dcm`));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};

const P_FOR = '2.25.45100';
const S_FOR = '2.25.45200';
const P_SERIES = '2.25.1002';
const P_SOP = '2.25.1003';
const S_SOP = '2.25.45202';

const names = set => set.landmarks.map(landmark => landmark.name);
const kinds = set => set.landmarks.map(landmark => landmark.type.kind);
const codesOf = diagnostics => diagnostics.map(diagnostic => diagnostic.code);


describe('the reference set (application and exchange roots)', () => {
  ['landmarks-patient', 'landmarks-exchange'].forEach((topic) => {
    it(`${topic}: one set with its name, label, description, Source-Series and colours`, () => {
      const { sets } = readLandmarkSets(fixture(topic));
      expect(sets).toHaveLength(1);
      const [set] = sets;
      expect(set).toMatchObject({
        trackingUid: '2.25.47201',
        trackingIdentifier: 'cornerstoneTools@^4.0.0:SonadorLandmarkSet',
        legacy: false,
        concept: { value: 'PELVIS-SET', schemeDesignator: '99EXAMPLE', meaning: 'Pelvic landmarks' },
        label: 'Pelvis (planning)',
        name: 'Pelvic landmarks',
        description: 'Points picked on the planning model',
        sourceSeries: P_SERIES,
        domain: 'patient',
        frameOfReferenceUID: P_FOR,
        image: null,
      });
      expect(Object.keys(set.display)).toEqual(['Line', 'Text']);
    });
  });

  it('keeps the landmarks in order, each with its own position and Fiducial UID', () => {
    const [set] = readLandmarkSets(fixture('landmarks-patient')).sets;
    expect(set.landmarks.map(landmark => landmark.point)).toEqual(
      Array.from({ length: 10 }, (_unused, index) => [10 + index, 20 + index, 30 + index]));
    expect(set.landmarks.map(landmark => landmark.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    set.landmarks.forEach((landmark) => {
      expect(landmark.fiducialUid).toMatch(/^[0-9.]+$/);
      expect(landmark.id).toBe(landmark.fiducialUid);
      expect(landmark.provisional).toBeUndefined();
    });
    expect(new Set(set.landmarks.map(landmark => landmark.id)).size).toBe(10);
  });

  it('names a landmark by its concept, else its label, and never by the reserved Point value', () => {
    const [set] = readLandmarkSets(fixture('landmarks-patient')).sets;
    expect(names(set)).toEqual([
      'Left anterior superior iliac spine', // concept and label: the concept's meaning
      'Label only',
      'Pubic symphysis', // concept only
      'Left anterior superior iliac spine',
      null, // neither: the reserved Point value is no name
      'Line override',
      'Épine iliaque antérieure', // UTF-8, read as written
      'Tear drop',
      'Tear drop',
      null, // a Registration landmark with no concept and no label
    ]);
    expect(set.landmarks.map(landmark => landmark.label)).toEqual([
      'ASIS (left)', 'Label only', null, 'Concept and label', null, 'Line override', 'Épine iliaque antérieure', 'Tear drop', 'Tear drop', null,
    ]);
    expect(set.landmarks[2].concept).toEqual({ value: 'PUB-SYM', schemeDesignator: '99EXAMPLE', meaning: 'Pubic symphysis' });
    expect(set.landmarks[4].concept).toBeNull();
    expect(set.landmarks[0].description).toBe('Every attribute set');
    expect(set.landmarks.slice(1).map(landmark => landmark.description)).toEqual(Array(9).fill(null));
  });

  it('reads the three landmark types from the coordinate item', () => {
    const [set] = readLandmarkSets(fixture('landmarks-patient')).sets;
    expect(kinds(set)).toEqual(['Anatomic', 'Point', 'Point', 'Point', 'Point', 'Point', 'Point', 'Point', 'Point', 'Registration']);
    expect(set.landmarks[9].type).toEqual({
      kind: LANDMARK_TYPES.REGISTRATION, absent: false,
      code: { value: 'Sonador-Landmark.Registration', schemeDesignator: 'Sonador-SR', meaning: 'Registration' },
    });
  });

  it('resolves colours role by role: the landmark\'s own, else the set\'s', () => {
    const [set] = readLandmarkSets(fixture('landmarks-patient')).sets;
    const [all, , , , , override] = set.landmarks;
    expect(landmarkColors(set, all)).toEqual(all.display);
    expect(ownColorRoles(all)).toEqual({ Line: true, Text: true });
    // A Line override takes the set's Text
    expect(landmarkColors(set, override)).toEqual({ Line: override.display.Line, Text: set.display.Text });
    expect(ownColorRoles(override)).toEqual({ Line: true, Text: false });
    // No colour of its own: the set's
    expect(landmarkColors(set, set.landmarks[1])).toEqual(set.display);
    // Neither: the Viewer default
    expect(landmarkColors({ display: {} }, { display: {} })).toEqual({ Line: null, Text: null });
  });

  it('reads the same set the same way twice', () => {
    expect(readLandmarkSets(fixture('landmarks-patient'))).toEqual(readLandmarkSets(fixture('landmarks-patient')));
  });
});


describe('the other fixtures', () => {
  it('landmarks-mixed: one set beside a Series Tag, a Length and an arrow', () => {
    const dataset = fixture('landmarks-mixed');
    const { sets } = readLandmarkSets(dataset);
    expect(sets.map(set => [set.trackingUid, set.landmarks.length])).toEqual([['2.25.47201', 10]]);
    expect(holdsLandmarkSets(dataset)).toBe(true);
  });

  it('landmarks-image: two image-domain sets, each on its instance', () => {
    const { sets } = readLandmarkSets(fixture('landmarks-image'));
    expect(sets.map(set => [set.trackingUid, set.name, set.domain, set.image.sopInstanceUID, set.image.frameNumber])).toEqual([
      ['2.25.47202', 'Image landmarks', 'image', P_SOP, undefined],
      ['2.25.47203', 'Second image set', 'image', S_SOP, undefined],
    ]);
    expect(sets[0].frameOfReferenceUID).toBeNull();
    expect(sets[0].landmarks.map(landmark => [landmark.point, landmark.name])).toEqual([
      [[10.5, 20.5], 'Left anterior superior iliac spine'], [[30.25, 40], null], [[5, 6], 'Corner'],
    ]);
  });

  it('landmarks-application-frame: a set in an application frame and one in a parentless root frame', () => {
    const { sets } = readLandmarkSets(fixture('landmarks-application-frame'));
    expect(sets.map(set => [set.trackingUid, set.name, set.frameOfReferenceUID, set.landmarks.length])).toEqual([
      ['2.25.47204', 'Anatomic frame set', '2.25.47110', 2],
      ['2.25.47205', 'Implant frame set', '2.25.47120', 1],
    ]);
  });

  it('point-collection-legacy: two volume groups as sets, never the metadata group', () => {
    const dataset = fixture('point-collection-legacy');
    const { sets, diagnostics } = readLandmarkSets(dataset);
    expect(sets.map(set => [set.trackingUid, set.name, set.legacy, set.landmarks.length])).toEqual([
      ['2.25.47206', 'Femoral head points', true, 3],
      ['2.25.47207', 'Axis line', true, 1],
    ]);
    const [migratable, axis] = sets;
    expect(migratable.landmarks.map(landmark => [landmark.point, landmark.type.kind, landmark.name])).toEqual([
      [[1, 2, 3], 'Anatomic', null], [[4, 5, 6], 'Point', null], [[7, 8, 9], 'Point', null],
    ]);
    expect(migratable.frameOfReferenceUID).toBe(P_FOR);
    // The POLYLINE and the group measurement are not landmarks
    expect(axis.landmarks.map(landmark => landmark.point)).toEqual([[5, 5, 5]]);
    expect(codesOf(diagnostics).filter(code => code === 'landmark-legacy-collection')).toHaveLength(2);
    expect(holdsLandmarkSets(dataset)).toBe(true);
  });

  it('point-collection-legacy: the POINT keeps its Fiducial UID; the MULTIPOINT\'s points are identified by position, the same on every read', () => {
    const read = () => readLandmarkSets(fixture('point-collection-legacy')).sets[0].landmarks;
    const [point, first, second] = read();
    expect(point.fiducialUid).toMatch(/^[0-9.]+$/);
    expect(point.id).toBe(point.fiducialUid);
    expect([first.id, second.id]).toEqual(['position:2', 'position:3']);
    expect([first.provisional, second.provisional]).toEqual([true, true]);
    expect(read().map(landmark => landmark.id)).toEqual([point.id, first.id, second.id]);
  });

  it('point-collection-legacy-mixed-frames: the points of the first frame only, with a warning', () => {
    const { sets, diagnostics } = readLandmarkSets(fixture('point-collection-legacy-mixed-frames'));
    expect(sets).toHaveLength(1);
    expect(sets[0].frameOfReferenceUID).toBe(P_FOR);
    expect(sets[0].landmarks.map(landmark => landmark.point)).toEqual([[1, 2, 3], [7, 8, 9]]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ level: 'warning', code: 'landmark-set-mixed-frames', trackingUid: '2.25.47208' }));
  });
});


// Synthetic groups

const code = (value, schemeDesignator, meaning) => ({ CodeValue: value, CodingSchemeDesignator: schemeDesignator, CodeMeaning: meaning });
const LANDMARK = code('Sonador-Landmark', 'Sonador-SR', 'Landmark');
const POINT = code('Sonador-Landmark.Point', 'Sonador-SR', 'Point');
const FREE_TEXT = label => code('CORNERSTONEFREETEXT', 'CST4', label);
const text = (value, codeValue = 'Sonador-Measurement.Text') => ({
  RelationshipType: 'HAS PROPERTIES', ValueType: 'TEXT', ConceptNameCodeSequence: [code(codeValue, 'Sonador-SR', '')], TextValue: value,
});
const scoord3d = (point, { frame = P_FOR, type = POINT, graphicType = 'POINT', fiducial } = {}) => ({
  RelationshipType: 'INFERRED FROM', ValueType: 'SCOORD3D', ...(type ? { ConceptNameCodeSequence: [type] } : {}),
  GraphicType: graphicType, GraphicData: point, ReferencedFrameOfReferenceUID: frame, ...(fiducial ? { FiducialUID: fiducial } : {}),
});
const scoord = (point, { sop = P_SOP, frames, origin = 'FRAME' } = {}) => ({
  RelationshipType: 'INFERRED FROM', ValueType: 'SCOORD', ConceptNameCodeSequence: [POINT], GraphicType: 'POINT', GraphicData: point,
  ...(origin ? { PixelOriginInterpretation: origin } : {}),
  ContentSequence: [{
    RelationshipType: 'SELECTED FROM', ValueType: 'IMAGE',
    ReferencedSOPSequence: [{ ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.4', ReferencedSOPInstanceUID: sop,
      ...(frames !== undefined ? { ReferencedFrameNumber: frames } : {}) }],
  }],
});
const landmark = (value, ...children) => ({
  RelationshipType: 'CONTAINS', ValueType: 'CODE', ConceptNameCodeSequence: [LANDMARK], ConceptCodeSequence: [value], ContentSequence: children,
});
const group = (trackingUid, finding, ...items) => ({
  RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: [code('125007', 'DCM', 'Measurement Group')],
  ContentSequence: [
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'TEXT', ConceptNameCodeSequence: [code('112039', 'DCM', 'Tracking Identifier')],
      TextValue: 'Cornerstone3DTools@^0.1.0:SonadorLandmarkSet' },
    { RelationshipType: 'HAS OBS CONTEXT', ValueType: 'UIDREF', ConceptNameCodeSequence: [code('112040', 'DCM', 'Tracking Unique Identifier')],
      UID: trackingUid },
    ...(finding ? [{ RelationshipType: 'CONTAINS', ValueType: 'CODE', ConceptNameCodeSequence: [code('121071', 'DCM', 'Finding')],
      ConceptCodeSequence: [finding] }] : []),
    ...items,
  ],
});
const documentOf = (...groups) => ({
  SOPInstanceUID: '2.25.99', ConceptNameCodeSequence: [code('126000', 'DCM', 'Imaging Measurement Report')],
  ContentSequence: [{ RelationshipType: 'CONTAINS', ValueType: 'CONTAINER', ConceptNameCodeSequence: [code('126010', 'DCM', 'Imaging Measurements')],
    ContentSequence: groups }],
});

describe('synthetic groups', () => {
  it('reads either tracking identifier prefix, and no other', () => {
    expect(isLandmarkSetTrackingIdentifier('cornerstoneTools@^4.0.0:SonadorLandmarkSet')).toBe(true);
    expect(isLandmarkSetTrackingIdentifier('Cornerstone3DTools@^0.1.0:SonadorLandmarkSet')).toBe(true);
    expect(isLandmarkSetTrackingIdentifier('other@1:SonadorLandmarkSet')).toBe(false);
    expect(isLandmarkSetTrackingIdentifier('cornerstoneTools@^4.0.0:Length')).toBe(false);
  });

  it('skips the landmark items it cannot read, with a warning each, and reads the rest in order', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.1', FREE_TEXT('Set'),
      landmark(FREE_TEXT('first'), scoord3d([1, 2, 3])),
      landmark(FREE_TEXT('no coordinate')),
      landmark(FREE_TEXT('two coordinates'), scoord3d([1, 1, 1]), scoord3d([2, 2, 2])),
      landmark(FREE_TEXT('polyline'), scoord3d([1, 1, 1, 2, 2, 2], { graphicType: 'POLYLINE' })),
      landmark(FREE_TEXT('two values'), scoord3d([1, 1])),
      landmark(FREE_TEXT('not finite'), scoord3d([1, NaN, 1])),
      landmark(FREE_TEXT('last'), scoord3d([4, 5, 6])),
      // Unknown children are ignored
      { RelationshipType: 'CONTAINS', ValueType: 'TEXT', ConceptNameCodeSequence: [code('X', '99EXAMPLE', 'Unknown')], TextValue: 'x' },
    )));
    expect(sets).toHaveLength(1);
    expect(names(sets[0])).toEqual(['first', 'last']);
    expect(sets[0].landmarks.map(l => l.ordinal)).toEqual([1, 2]);
    expect(diagnostics.filter(d => d.level === 'warning').map(d => [d.code, d.detail])).toEqual([
      ['landmark-without-point', 'landmark item 2'],
      ['landmark-point-ambiguous', 'landmark item 3'],
      ['landmark-without-point', 'landmark item 4'],
      ['landmark-point-invalid', 'landmark item 5'],
      ['landmark-point-invalid', 'landmark item 6'],
    ]);
  });

  it('a partial read: the first readable landmark sets the frame; a later one in another frame is skipped', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.2', FREE_TEXT('Set'),
      landmark(POINT, scoord3d([1, 1])),
      landmark(POINT, scoord3d([1, 2, 3], { frame: S_FOR })),
      landmark(POINT, scoord3d([4, 5, 6], { frame: P_FOR })),
      landmark(POINT, scoord3d([7, 8, 9], { frame: S_FOR })),
      landmark(POINT, scoord([1, 2])),
    )));
    expect(sets[0].frameOfReferenceUID).toBe(S_FOR);
    expect(sets[0].landmarks.map(l => l.point)).toEqual([[1, 2, 3], [7, 8, 9]]);
    expect(codesOf(diagnostics.filter(d => d.level === 'warning'))).toEqual([
      'landmark-point-invalid', 'landmark-set-mixed-frames', 'landmark-set-mixed-frames',
    ]);
  });

  it('an image-domain set on one frame of a multiframe instance: a landmark on another frame is skipped', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.3', FREE_TEXT('Frames'),
      landmark(POINT, scoord([1, 2], { frames: 2 })),
      landmark(POINT, scoord([3, 4], { frames: 1 })),
      landmark(POINT, scoord([5, 6], { frames: 2 })),
      landmark(POINT, scoord([7, 8], { frames: [1, 2] })),
    )));
    expect(sets[0].image).toEqual({ sopInstanceUID: P_SOP, sopClassUID: '1.2.840.10008.5.1.4.1.1.4', frameNumber: 2 });
    expect(sets[0].landmarks.map(l => l.point)).toEqual([[1, 2], [5, 6]]);
    expect(codesOf(diagnostics.filter(d => d.level === 'warning'))).toEqual([
      'landmark-set-mixed-frames', 'landmark-image-reference-ambiguous',
    ]);
  });

  it('skips an image coordinate in the Total Pixel Matrix or without an image, and reads an absent pixel origin as FRAME', () => {
    const noImage = { ...scoord([1, 1]), ContentSequence: [] };
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.4', FREE_TEXT('Pixels'),
      landmark(POINT, scoord([1, 1], { origin: 'VOLUME' })),
      landmark(POINT, noImage),
      landmark(POINT, scoord([2, 3], { origin: null })),
    )));
    expect(sets[0].landmarks.map(l => l.point)).toEqual([[2, 3]]);
    expect(codesOf(diagnostics.filter(d => d.level === 'warning'))).toEqual([
      'landmark-pixel-origin-unsupported', 'landmark-image-reference-missing',
    ]);
  });

  it('keeps an unknown type and reads an absent one as Point; neither makes a name', () => {
    const unknown = code('FOREIGN-TYPE', '99EXAMPLE', 'Foreign type');
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.5', FREE_TEXT('Types'),
      landmark(POINT, scoord3d([1, 1, 1], { type: null })),
      landmark(POINT, scoord3d([2, 2, 2], { type: unknown })),
      // A 0.2 code in a 0.3 group is an unknown type
      landmark(POINT, scoord3d([3, 3, 3], { type: code('Sonador-Coord3D-Anatomic', 'Sonador-SR', 'Anatomic') })),
      // A familiar spelling in another scheme is an unknown type too
      landmark(POINT, scoord3d([4, 4, 4], { type: code('Sonador-Landmark.Anatomic', '99EXAMPLE', 'Anatomic') })),
    )));
    expect(sets[0].landmarks.map(l => [l.type.kind, l.type.absent, l.type.code && l.type.code.value, l.name])).toEqual([
      ['Point', true, null, null],
      ['unknown', false, 'FOREIGN-TYPE', null],
      ['unknown', false, 'Sonador-Coord3D-Anatomic', null],
      ['unknown', false, 'Sonador-Landmark.Anatomic', null],
    ]);
    expect(codesOf(diagnostics).filter(c => c.startsWith('landmark-type'))).toEqual([
      'landmark-type-absent', 'landmark-type-unknown', 'landmark-type-unknown', 'landmark-type-unknown',
    ]);
    expect(diagnostics.every(d => d.level === 'info')).toBe(true);
  });

  it('names: a label beside the reserved Point value is the label; a free-text value with a Text child is the value', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.6', code('Sonador-Landmark.Point', 'Sonador-SR', 'Point'),
      landmark(POINT, scoord3d([1, 1, 1]), text('Beside Point')),
      landmark(FREE_TEXT('Free text'), scoord3d([2, 2, 2]), text('Duplicate')),
      landmark(code('Sonador-Landmark.Point', '99EXAMPLE', 'Point elsewhere'), scoord3d([3, 3, 3])),
      landmark(FREE_TEXT('   '), scoord3d([4, 4, 4])),
    )));
    expect(names(sets[0])).toEqual(['Beside Point', 'Free text', 'Point elsewhere', null]);
    expect(sets[0].landmarks[2].concept).toMatchObject({ value: 'Sonador-Landmark.Point', schemeDesignator: '99EXAMPLE' });
    // The reserved Point code is a valid concept of a set
    expect(sets[0]).toMatchObject({ name: 'Point', concept: { value: 'Sonador-Landmark.Point' } });
    expect(codesOf(diagnostics)).toContain('landmark-label-duplicate');
  });

  it('a set with no concept and no label is read with no name, with a warning', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.7', null, landmark(POINT, scoord3d([1, 1, 1])))));
    expect(sets[0]).toMatchObject({ name: '', concept: null, label: null });
    expect(codesOf(diagnostics)).toContain('landmark-set-without-name');
  });

  it('a group with no readable landmark is not a set, and the groups after it are still read', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(
      group('2.25.8', FREE_TEXT('Empty')),
      group('2.25.9', FREE_TEXT('Unreadable'), landmark(POINT)),
      // A malformed group: a landmark item without a ContentSequence or a concept
      group('2.25.10', FREE_TEXT('Malformed'), { ValueType: 'CODE', ConceptNameCodeSequence: [LANDMARK] }),
      group('2.25.11', FREE_TEXT('Readable'), landmark(POINT, scoord3d([1, 1, 1]))),
    ));
    expect(sets.map(set => set.trackingUid)).toEqual(['2.25.11']);
    expect(diagnostics.filter(d => d.level === 'warning').map(d => [d.trackingUid, d.code])).toEqual([
      ['2.25.8', 'landmark-set-empty'], ['2.25.8', 'landmark-set-read-as-group'],
      ['2.25.9', 'landmark-without-point'], ['2.25.9', 'landmark-set-read-as-group'],
      ['2.25.10', 'landmark-without-point'], ['2.25.10', 'landmark-set-read-as-group'],
    ]);
  });

  it('identifies a landmark without a Fiducial UID by its position, and keeps both of a duplicated UID', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.12', FREE_TEXT('Identity'),
      landmark(POINT, scoord3d([1, 1, 1], { fiducial: '2.25.500' })),
      landmark(POINT, scoord3d([2, 2, 2])),
      landmark(POINT, scoord3d([3, 3, 3], { fiducial: '2.25.500' })),
    )));
    expect(sets[0].landmarks.map(l => l.id)).toEqual(['2.25.500', 'position:2', '2.25.500#3']);
    expect(codesOf(diagnostics)).toEqual(expect.arrayContaining(['landmark-identity-provisional', 'duplicate-fiducial-uid']));
  });

  it('a metadata group with the legacy template identifier is not a set', () => {
    const legacy = (rootValue) => ({
      ContentSequence: [{
        ValueType: 'CONTAINER', ConceptNameCodeSequence: [code(rootValue, 'Sonador-SR', '')],
        ContentSequence: [{
          ValueType: 'CONTAINER', ContentTemplateSequence: [{ TemplateIdentifier: 'Sonador-SR.1002', MappingResource: 'Sonador-SR' }],
          ConceptNameCodeSequence: [code('125007', 'DCM', 'Report Group')],
          ContentSequence: [
            { ValueType: 'TEXT', ConceptNameCodeSequence: [code('112039', 'DCM', '')], TextValue: 'Points' },
            { ValueType: 'UIDREF', ConceptNameCodeSequence: [code('112040', 'DCM', '')], UID: '2.25.13' },
            scoord3d([1, 2, 3], { type: null }),
          ],
        }],
      }],
    });
    expect(readLandmarkSets(legacy('Clinical-Report.Meta')).sets).toEqual([]);
    expect(holdsLandmarkSets(legacy('Clinical-Report.Meta'))).toBe(false);
    expect(readLandmarkSets(legacy('Clinical-Report.Volume-Measurements')).sets.map(set => set.trackingUid)).toEqual(['2.25.13']);
  });
});


describe('malformed references, pixel origins and properties', () => {
  const withoutSOP = (point) => {
    const coordinate = scoord(point);
    coordinate.ContentSequence[0].ReferencedSOPSequence = [{ ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.4' }];
    return coordinate;
  };

  it('an image reference without a SOP Instance UID is skipped, and the next readable landmark fixes the image', () => {
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.20', FREE_TEXT('Malformed first'),
      landmark(POINT, withoutSOP([1, 2])),
      landmark(POINT, scoord([4, 5])),
    )));
    expect(sets[0].image).toMatchObject({ sopInstanceUID: P_SOP });
    expect(sets[0].landmarks.map(l => l.point)).toEqual([[4, 5]]);
    expect(diagnostics.filter(d => d.level === 'warning').map(d => [d.code, d.detail])).toEqual([
      ['landmark-image-reference-missing', 'landmark item 1'],
    ]);
  });

  it('a patient coordinate without a Frame of Reference is skipped, and the next readable landmark fixes the frame', () => {
    const noFrame = { ...scoord3d([1, 1, 1]), ReferencedFrameOfReferenceUID: undefined };
    const { sets, diagnostics } = readLandmarkSets(documentOf(group('2.25.21', FREE_TEXT('No frame first'),
      landmark(POINT, noFrame),
      landmark(POINT, scoord3d([2, 2, 2])),
    )));
    expect(sets[0].frameOfReferenceUID).toBe(P_FOR);
    expect(sets[0].landmarks.map(l => l.point)).toEqual([[2, 2, 2]]);
    expect(codesOf(diagnostics.filter(d => d.level === 'warning'))).toEqual(['landmark-frame-missing']);
  });

  it('on a tiled image whose metadata is cached, a coordinate without a pixel origin is skipped and FRAME is kept', () => {
    const tiled = { SOPInstanceUID: P_SOP, SOPClassUID: '1.2.840.10008.5.1.4.1.1.77.1.6', TotalPixelMatrixColumns: 4096, TotalPixelMatrixRows: 4096 };
    const dataset = () => documentOf(group('2.25.22', FREE_TEXT('Tiled'),
      landmark(POINT, scoord([1, 2], { frames: 2, origin: null })),
      landmark(POINT, scoord([3, 4], { frames: 2 })),
    ));
    const onTiled = readLandmarkSets(dataset(), { instanceOf: uid => (uid === P_SOP ? tiled : undefined) });
    expect(onTiled.sets[0].landmarks.map(l => l.point)).toEqual([[3, 4]]);
    expect(codesOf(onTiled.diagnostics.filter(d => d.level === 'warning'))).toEqual(['landmark-pixel-origin-unsupported']);
    // An ordinary image, or one whose metadata is not cached: both are read
    const ordinary = { SOPInstanceUID: P_SOP, SOPClassUID: '1.2.840.10008.5.1.4.1.1.4', NumberOfFrames: 2 };
    expect(readLandmarkSets(dataset(), { instanceOf: () => ordinary }).sets[0].landmarks).toHaveLength(2);
    expect(readLandmarkSets(dataset()).sets[0].landmarks).toHaveLength(2);
  });

  const finding = (value, ...children) => ({
    RelationshipType: 'CONTAINS', ValueType: 'CODE', ConceptNameCodeSequence: [code('121071', 'DCM', 'Finding')],
    ConceptCodeSequence: [value], ContentSequence: children,
  });
  const PELVIS = code('PELVIS', '99EXAMPLE', 'Pelvis');
  const groupWith = (trackingUid, ...items) => {
    const built = group(trackingUid, null, landmark(POINT, scoord3d([1, 1, 1])));
    built.ContentSequence.push(...items);
    return built;
  };

  it('a set label stored at group level (flat layout) is the label beside its concept', () => {
    const flat = { ...text('Pelvis plan'), RelationshipType: 'HAS CONCEPT MOD' };
    const [set] = readLandmarkSets(documentOf(groupWith('2.25.23', finding(PELVIS), flat))).sets;
    expect(set).toMatchObject({ name: 'Pelvis', concept: { value: 'PELVIS' }, label: 'Pelvis plan' });
  });

  it('a label under the Finding takes precedence over one at group level', () => {
    const flat = { ...text('Flat label'), RelationshipType: 'HAS CONCEPT MOD' };
    const [set] = readLandmarkSets(documentOf(groupWith('2.25.24', finding(PELVIS, text('Nested label')), flat))).sets;
    expect(set.label).toBe('Nested label');
  });

  it('matches property codes by coding scheme and value: a foreign code of the same value is ignored', () => {
    const foreign = { ...text('Not a label'), ConceptNameCodeSequence: [code('Sonador-Measurement.Text', '99OTHER', '')] };
    const foreignDescription = { ...text('Not a description', 'Sonador-Measurement.Description'),
      ConceptNameCodeSequence: [code('Sonador-Measurement.Description', '99OTHER', '')] };
    const { sets } = readLandmarkSets(documentOf(group('2.25.25', FREE_TEXT('Scheme'),
      landmark(POINT, scoord3d([1, 1, 1]), foreign, foreignDescription),
      landmark(POINT, scoord3d([2, 2, 2]), text('Genuine label'), text('Genuine description', 'Sonador-Measurement.Description')),
    )));
    expect(sets[0].landmarks.map(l => [l.name, l.label, l.description])).toEqual([
      [null, null, null],
      ['Genuine label', 'Genuine label', 'Genuine description'],
    ]);
  });
});
