// A UTF-8 (ISO_IR 192) Part 10 file reads with its text decoded as UTF-8 at every level: dcmjs reads
// sequence items with its default decoder, and readDicomFile decodes their text again.

import { data as dcmjsData } from 'dcmjs';

import { readDicomFile, repairNestedText } from './dicomCharacterSet';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const TEXT = 'Läsion — 肺, “quoted”, €';

function part10(dataset) {
  const meta = {
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34', MediaStorageSOPInstanceUID: '2.25.1',
    TransferSyntaxUID: '1.2.840.10008.1.2.1', ImplementationClassUID: '2.25.2',
  };
  const dict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dict.dict = DicomMetaDictionary.denaturalizeDataset({ SOPClassUID: '1.2.840.10008.5.1.4.1.1.88.34', SOPInstanceUID: '2.25.1', ...dataset });
  const buffer = Buffer.from(dict.write());
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
const nested = text => ({
  SeriesDescription: text,
  ContentSequence: [{
    TextValue: text,
    ConceptCodeSequence: [{ CodeValue: 'CORNERSTONEFREETEXT', CodingSchemeDesignator: 'CST4', CodeMeaning: text }],
  }],
});
const textsOf = (dict) => {
  const dataset = DicomMetaDictionary.naturalizeDataset(dict);
  const [item] = dataset.ContentSequence;
  const code = Array.isArray(item.ConceptCodeSequence) ? item.ConceptCodeSequence[0] : item.ConceptCodeSequence;
  return [dataset.SeriesDescription, item.TextValue, code.CodeMeaning];
};

it('reads the text of a UTF-8 file as written, nested items included (dcmjs alone does not)', () => {
  const buffer = part10({ SpecificCharacterSet: 'ISO_IR 192', ...nested(TEXT) });
  const [, garbled] = textsOf(DicomMessage.readFile(buffer).dict);
  expect(garbled).not.toBe(TEXT);
  expect(textsOf(readDicomFile(buffer).dict)).toEqual([TEXT, TEXT, TEXT]);
});

it('leaves a file in another character set, or ASCII text, as dcmjs reads it', () => {
  const ascii = part10(nested('Lesion'));
  expect(textsOf(readDicomFile(ascii).dict)).toEqual(['Lesion', 'Lesion', 'Lesion']);
  const latin1 = { '00080005': { vr: 'CS', Value: ['ISO_IR 100'] }, '0040A730': { vr: 'SQ', Value: [{ '0040A160': { vr: 'UT', Value: ['Ã©'] } }] } };
  expect(repairNestedText(latin1)['0040A730'].Value[0]['0040A160'].Value).toEqual(['Ã©']);
});

it('keeps text that is not valid UTF-8 as read', () => {
  const dict = { '00080005': { vr: 'CS', Value: ['ISO_IR 192'] }, '0040A730': { vr: 'SQ', Value: [{ '0040A160': { vr: 'UT', Value: ['é'] } }] } };
  expect(repairNestedText(dict)['0040A730'].Value[0]['0040A160'].Value).toEqual(['é']);
});

// The serialized file with each ASCII placeholder replaced by bytes of the same length
function patched(buffer, replacements) {
  const bytes = new Uint8Array(buffer);
  replacements.forEach(([placeholder, replacement]) => {
    const marker = Buffer.from(placeholder, 'ascii');
    const at = Buffer.from(bytes).indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    bytes.set(replacement, at);
  });
  return buffer;
}
const contentOf = item => (Array.isArray(item.ContentSequence) ? item.ContentSequence : [item.ContentSequence]);

it('reads each item in the character set it declares, and its nested items in the one in effect', () => {
  // Root UTF-8; an item declaring ISO_IR 100 holds the bytes C3 A9 (the two characters "Ã©" in it),
  // with a nested item inheriting ISO_IR 100; another item declares UTF-8 and holds a nested item
  // two levels down inheriting it
  const buffer = patched(part10({
    SpecificCharacterSet: 'ISO_IR 192',
    SeriesDescription: TEXT,
    ContentSequence: [
      { SpecificCharacterSet: 'ISO_IR 100', TextValue: 'QZ', ContentSequence: [{ TextValue: 'QW' }] },
      { SpecificCharacterSet: 'ISO_IR 192', TextValue: TEXT, ContentSequence: [{ ContentSequence: [{ TextValue: TEXT }] }] },
      { ContentSequence: [{ ContentSequence: [{ TextValue: TEXT }] }] },
    ],
  }), [['QZ', [0xc3, 0xa9]], ['QW', [0xc3, 0xa9]]]);

  const dataset = DicomMetaDictionary.naturalizeDataset(readDicomFile(buffer).dict);
  const [latin1, declared, inherited] = dataset.ContentSequence;
  expect(dataset.SeriesDescription).toBe(TEXT);
  expect(Array.from(latin1.TextValue).map(c => c.charCodeAt(0))).toEqual([0xc3, 0xa9]);
  expect(Array.from(contentOf(latin1)[0].TextValue).map(c => c.charCodeAt(0))).toEqual([0xc3, 0xa9]);
  expect(declared.TextValue).toBe(TEXT);
  expect(contentOf(contentOf(declared)[0])[0].TextValue).toBe(TEXT);
  expect(contentOf(contentOf(inherited)[0])[0].TextValue).toBe(TEXT);
});

it('leaves an item in another set alone under a UTF-8 file, and a UTF-8 item under a file in another set is repaired', () => {
  const dict = {
    '00080005': { vr: 'CS', Value: ['ISO_IR 192'], _rawValue: ['ISO_IR 100'] },
    '0040A730': { vr: 'SQ', Value: [
      { '0040A160': { vr: 'UT', Value: ['Ã©'] } },
      { '00080005': { vr: 'CS', Value: ['ISO_IR 192'], _rawValue: ['ISO_IR 192'] },
        '0040A730': { vr: 'SQ', Value: [{ '0040A160': { vr: 'UT', Value: ['Ã©'] } }] } },
    ] },
  };
  const [other, utf8] = repairNestedText(dict)['0040A730'].Value;
  // dcmjs reports every declared set as ISO_IR 192; the raw value is the one declared
  expect(other['0040A160'].Value).toEqual(['Ã©']);
  expect(utf8['0040A730'].Value[0]['0040A160'].Value).toEqual(['é']);
});
