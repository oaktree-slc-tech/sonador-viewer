import { data as dcmjsData } from 'dcmjs';

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: {
    Cornerstone: {},
    Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} }, MeasurementReport: {} },
  },
}), { virtual: true });
jest.mock('../../measurements/enums', () => ({
  __esModule: true,
  default: { SREnums: jest.requireActual('../enums').Enums },
}));
jest.mock('../../measurements/classes', () => ({
  MeasurementApi: {
    _unpackMeasurementData: measurement => ({
      measurementMeta: measurement.metadata || measurement,
      measurementData: measurement.data || measurement.measurementData || measurement,
    }),
  },
}));

import { encodeDisplayAttributes, parseDisplayAttributes } from './dcmsrDisplayAttributes';
import { encodeExtendedMeta } from './dcmsrExtendedMeta';
import { SonadorCodeValues } from '../enums';
import {
  SERIES_TAG_TOOL,
  resolveDisplayAttributes,
  resolveFindingColor,
  setSiteDisplayAttributes,
} from '../../displayAttributes';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const COLOR = { Background: '#112233', Border: '#00FF00', Value: '#FF0000', Meaning: '#C0C7F8' };

const findingGroup = () => ({
  RelationshipType: 'CONTAINS',
  ValueType: 'CONTAINER',
  ConceptNameCodeSequence: [{ CodeValue: '125007', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Measurement Group' }],
  ContinuityOfContent: 'SEPARATE',
  ContentSequence: [{
    RelationshipType: 'CONTAINS',
    ValueType: 'CODE',
    ConceptNameCodeSequence: [{ CodeValue: '121071', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Finding' }],
    ConceptCodeSequence: [{ CodeValue: 'RID1301', CodingSchemeDesignator: 'RADLEX', CodeMeaning: 'Lung' }],
  }],
});

const conceptOf = item => [].concat(item.ConceptNameCodeSequence)[0];
const contentOf = item => [].concat(item.ContentSequence || []);

// Write the group into a Part 10 SR instance and read it back from the binary
const writeAndRead = srItem => {
  const dataset = {
    _meta: {
      FileMetaInformationVersion: { Value: [new Uint8Array([0, 1]).buffer], vr: 'OB' },
      MediaStorageSOPClassUID: { Value: ['1.2.840.10008.5.1.4.1.1.88.34'], vr: 'UI' },
      MediaStorageSOPInstanceUID: { Value: ['1.2.3.4.5'], vr: 'UI' },
      TransferSyntaxUID: { Value: ['1.2.840.10008.1.2.1'], vr: 'UI' },
      ImplementationClassUID: { Value: ['1.2.3.4'], vr: 'UI' },
    },
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34',
    SOPInstanceUID: '1.2.3.4.5',
    Modality: 'SR',
    ValueType: 'CONTAINER',
    ContentSequence: [JSON.parse(JSON.stringify(srItem))],
  };
  const dicomDict = new DicomDict(dataset._meta);
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  const read = DicomMessage.readFile(dicomDict.write());
  return contentOf(DicomMetaDictionary.naturalizeDataset(read.dict))[0];
};

// Denaturalize then naturalize, as the SR is written and read back
const roundTrip = srItem => DicomMetaDictionary.naturalizeDataset(
  DicomMetaDictionary.denaturalizeDataset(JSON.parse(JSON.stringify(srItem))));

describe('encodeDisplayAttributes', () => {
  it('nested (default): the Finding HAS PROPERTIES the extended meta and a display container of CIELab items', () => {
    const measurement = { description: 'Left lobe', data: { displayAttributes: { Color: COLOR } } };
    const srItem = findingGroup();

    encodeExtendedMeta(measurement, srItem);
    encodeDisplayAttributes(measurement, srItem);

    const [finding] = srItem.ContentSequence;
    expect(srItem.ContentSequence).toHaveLength(1);
    expect(finding.ValueType).toBe('CODE');
    const [description, display] = finding.ContentSequence;
    expect(description.TextValue).toBe('Left lobe');
    expect(description.RelationshipType).toBe('HAS PROPERTIES');
    expect(display.ValueType).toBe('CONTAINER');
    expect(display.RelationshipType).toBe('HAS PROPERTIES');
    expect(conceptOf(display).CodingSchemeVersion).toBe('0.3');
    expect(conceptOf(display).LongCodeValue).toBe(SonadorCodeValues.DCMSR_DISPLAY_ATTRIBUTES.value);

    const [color] = display.ContentSequence;
    expect(color.ValueType).toBe('CONTAINER');
    expect(color.RelationshipType).toBe('CONTAINS');
    expect(conceptOf(color).LongCodeValue).toBe(SonadorCodeValues.DCMSR_DISPLAY_COLOR.value);
    expect(color.ContentSequence.map(item => conceptOf(item).LongCodeValue)).toEqual(
      ['Background', 'Border', 'Value', 'Meaning'].map(role => SonadorCodeValues.DCMSR_DISPLAY_COLOR_ROLES[role].value));
    color.ContentSequence.forEach(item => {
      expect(item.ValueType).toBe('TEXT');
      expect(item.RelationshipType).toBe('CONTAINS');
      expect(item.TextValue).toMatch(/^\d+\\\d+\\\d+$/);
    });
  });

  it('flat: the color role TEXT items are HAS PROPERTIES children of the Finding, with no CONTAINER', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: COLOR } }, srItem, { layout: 'flat' });

    const [finding] = srItem.ContentSequence;
    expect(finding.ContentSequence.map(item => conceptOf(item).LongCodeValue)).toEqual(
      ['Background', 'Border', 'Value', 'Meaning'].map(role => SonadorCodeValues.DCMSR_DISPLAY_COLOR_ROLES[role].value));
    finding.ContentSequence.forEach(item => {
      expect(item.ValueType).toBe('TEXT');
      expect(item.RelationshipType).toBe('HAS PROPERTIES');
    });
    expect(parseDisplayAttributes(srItem, {}, { path: 'displayAttributes' })).toEqual({ displayAttributes: { Color: COLOR } });
  });

  it('keeps the group-level container for a group with no Finding', () => {
    const srItem = findingGroup();
    srItem.ContentSequence = [];
    encodeExtendedMeta({ description: 'Left lobe' }, srItem);
    encodeDisplayAttributes({ displayAttributes: { Color: COLOR } }, srItem, { layout: 'flat' });

    const [description, display] = srItem.ContentSequence;
    expect(description.RelationshipType).toBe('HAS CONCEPT MOD');
    expect(display.RelationshipType).toBe('CONTAINS');
    expect(display.ValueType).toBe('CONTAINER');
  });

  it('uses only CONTAINER sources for CONTAINS and keeps CodeValue within 16 characters', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: COLOR } }, srItem);

    const visit = (item, parent) => {
      if (parent && item.RelationshipType === 'CONTAINS') {
        expect(parent.ValueType).toBe('CONTAINER');
      }
      if (item.RelationshipType === 'HAS CONCEPT MOD') {
        expect(['TEXT', 'CODE']).toContain(item.ValueType);
      }
      const concept = conceptOf(item);
      if (concept && concept.CodeValue !== undefined) {
        expect(concept.CodeValue.length).toBeLessThanOrEqual(16);
      }
      if (concept && concept.LongCodeValue !== undefined) {
        expect(concept.CodeValue).toBeUndefined();
        expect(concept.LongCodeValue.length).toBeGreaterThan(16);
      }
      contentOf(item).forEach(child => visit(child, item));
    };
    visit(srItem, null);
  });

  it('writes only the roles that are set and nothing when no color is set', () => {
    const partial = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: { Value: '#FF0000', Background: null } } }, partial);
    expect(partial.ContentSequence[0].ContentSequence[0].ContentSequence[0].ContentSequence).toHaveLength(1);

    const none = findingGroup();
    encodeDisplayAttributes({ data: {} }, none);
    expect(none.ContentSequence).toHaveLength(1);
    expect(none.ContentSequence[0].ContentSequence).toBeUndefined();
  });
});

describe('parseDisplayAttributes', () => {
  it('restores the colors from a Part 10 write and read', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: COLOR } }, srItem);

    const group = writeAndRead(srItem);
    const color = contentOf(contentOf(contentOf(group)[0])[0])[0];
    expect(conceptOf(color).LongCodeValue).toBe(SonadorCodeValues.DCMSR_DISPLAY_COLOR.value);
    expect(parseDisplayAttributes(group, {}, { path: 'displayAttributes' })).toEqual({ displayAttributes: { Color: COLOR } });
  });

  it('reads the group-level container of files written before the colors moved under the Finding', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: COLOR } }, srItem);
    const [finding] = srItem.ContentSequence;
    const [display] = finding.ContentSequence;
    display.RelationshipType = 'CONTAINS';
    delete finding.ContentSequence;
    srItem.ContentSequence.push(display);

    expect(parseDisplayAttributes(writeAndRead(srItem), {}, { path: 'displayAttributes' }))
      .toEqual({ displayAttributes: { Color: COLOR } });
  });

  it('reads codes written as CodeValue', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: { Value: '#FF0000' } } }, srItem);
    const visit = item => {
      const concept = conceptOf(item);
      if (concept && concept.LongCodeValue) {
        concept.CodeValue = concept.LongCodeValue;
        delete concept.LongCodeValue;
      }
      contentOf(item).forEach(visit);
    };
    visit(srItem);

    expect(parseDisplayAttributes(srItem, {}, { path: 'displayAttributes' })).toEqual({ displayAttributes: { Color: { Value: '#FF0000' } } });
  });

  it('restores the colors written by encodeDisplayAttributes', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ metadata: { displayAttributes: { Color: COLOR } } }, srItem);

    const annotation = parseDisplayAttributes(roundTrip(srItem), { annotation: { data: {} } });
    expect(annotation.annotation.data.displayAttributes).toEqual({ Color: COLOR });
  });

  it('honors a custom path and leaves annotations without display attributes untouched', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: { Meaning: '#ABCDEF' } } }, srItem);
    expect(parseDisplayAttributes(srItem, {}, { path: 'displayAttributes' })).toEqual({ displayAttributes: { Color: { Meaning: '#ABCDEF' } } });

    expect(parseDisplayAttributes(findingGroup(), { annotation: { data: {} } })).toEqual({ annotation: { data: {} } });
  });

  it('skips an invalid color and keeps the others', () => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: { Color: { Value: '#FF0000', Meaning: '#00FF00' } } }, srItem);
    srItem.ContentSequence[0].ContentSequence[0].ContentSequence[0].ContentSequence[1].TextValue = 'not-a-color';

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const annotation = parseDisplayAttributes(srItem, {}, { path: 'displayAttributes' });
    warn.mockRestore();

    expect(annotation.displayAttributes).toEqual({ Color: { Value: '#FF0000' } });
  });
});

describe('saved finding colors', () => {
  afterEach(() => setSiteDisplayAttributes(null));

  it.each([
    ['transparent', null, null],
    ['opaque', { DisplayAttributes: { Color: { Background: '#123456' } } }, '#123456'],
  ])('keep a %s background after save, a Site default change, and reload', (label, meta, background) => {
    const srItem = findingGroup();
    encodeDisplayAttributes({ displayAttributes: resolveDisplayAttributes(SERIES_TAG_TOOL, meta) }, srItem);
    const group = writeAndRead(srItem);

    setSiteDisplayAttributes({ [SERIES_TAG_TOOL]: { Color: { Background: '#FFFFFF' } } });
    const annotation = parseDisplayAttributes(group, {}, { path: 'displayAttributes' });
    expect(resolveFindingColor(SERIES_TAG_TOOL, annotation)).toEqual({ Background: background, Border: '#FFFFFF', Value: '#8AD0A8', Meaning: '#C0C7F8' });
  });
});


describe('measurement line and text colors', () => {
  // A quantitative group: its properties are children of the NUM item
  const lengthGroup = () => ({
    RelationshipType: 'CONTAINS',
    ValueType: 'CONTAINER',
    ConceptNameCodeSequence: [{ CodeValue: '125007', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Measurement Group' }],
    ContinuityOfContent: 'SEPARATE',
    ContentSequence: [{
      RelationshipType: 'CONTAINS',
      ValueType: 'NUM',
      ConceptNameCodeSequence: [{ CodeValue: 'G-D7FE', CodingSchemeDesignator: 'SRT', CodeMeaning: 'Length' }],
      MeasuredValueSequence: [{ NumericValue: 12.5, MeasurementUnitsCodeSequence: [{ CodeValue: 'mm', CodingSchemeDesignator: 'UCUM', CodeMeaning: 'mm' }] }],
    }],
  });

  it('writes Line and Text under the NUM item and reads them back', () => {
    const srItem = lengthGroup();
    const color = { Line: '#FF8800', Text: '#00FF00' };
    encodeDisplayAttributes({ data: { displayAttributes: { Color: color } } }, srItem, { propertyParent: 'num' });

    const [num] = srItem.ContentSequence;
    const [display] = num.ContentSequence;
    const [colorContainer] = display.ContentSequence;
    expect(colorContainer.ContentSequence.map(item => conceptOf(item).LongCodeValue)).toEqual(
      ['Line', 'Text'].map(role => SonadorCodeValues.DCMSR_DISPLAY_COLOR_ROLES[role].value));
    expect(parseDisplayAttributes(writeAndRead(srItem), {}, { path: 'displayAttributes', propertyParent: 'num' }))
      .toEqual({ displayAttributes: { Color: color } });
  });
});
