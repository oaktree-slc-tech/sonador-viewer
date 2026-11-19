// The timepoint fixture packs written by the Sonador IO client (__fixtures__/timepoints, copied
// unchanged, with the manifest the generator wrote): the Viewer reads each file to the values of the
// manifest, the malformed items leniently with their warnings, and orders the revisions of a series
// as the contract says. The files are checked against the manifest's hashes before they are read.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { data as dcmjsData } from 'dcmjs';

jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });
const mockWarnings = [];
jest.mock('../log', () => ({
  __esModule: true,
  default: { info: () => {}, debug: () => {}, warn: (...args) => mockWarnings.push(args.join(' ')), error: () => {} },
}));

import { readDicomFile } from '../utils/dicomCharacterSet';
import { TIMEPOINT_CLASS_UID } from './constants/timepoint';
import { DIAGNOSTICS, compareTimepoints, timepointOf } from './utils/timepoint';
import { currentDocument, documentOrderOf } from './utils/srDocument';
import { asArray } from './utils/codedConcept';

const PACK = path.join(__dirname, '__fixtures__/timepoints');
const manifest = JSON.parse(fs.readFileSync(path.join(PACK, 'sonador-io.timepoints-manifest.2026-1118.json'), 'utf8'));
const files = manifest.files;

const bytesOf = name => fs.readFileSync(path.join(PACK, name));
const read = (name) => {
  const buffer = bytesOf(name);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return dcmjsData.DicomMetaDictionary.naturalizeDataset(readDicomFile(arrayBuffer).dict);
};
const file = topic => `sonador-io.timepoint-${topic}.2026-1118.dcm`;
const expected = (name) => {
  const { timepoint } = files[name];
  return timepoint ? { ...timepoint, dateValid: expect.any(Boolean), timeValid: expect.any(Boolean) } : null;
};
/** The tracking UIDs of the measurement groups a report holds */
const trackingUidsOf = (dataset) => {
  const found = [];
  const walk = items => asArray(items).forEach((item) => {
    if (item && item.ConceptNameCodeSequence && asArray(item.ConceptNameCodeSequence)[0].CodeValue === '112040' && item.UID) {
      found.push(item.UID);
    }
    walk(item && item.ContentSequence);
  });
  walk(dataset.ContentSequence);
  return found;
};

beforeEach(() => { mockWarnings.length = 0; });

it('holds the files the manifest names, unchanged', () => {
  expect(manifest.timepoint_class_uid).toBe(TIMEPOINT_CLASS_UID);
  Object.entries(files).forEach(([name, entry]) => {
    const hash = crypto.createHash('sha256').update(bytesOf(name)).digest('hex');
    expect(`${name}: ${hash}`).toBe(`${name}: ${entry.sha256}`);
  });
});

describe('the first pack', () => {
  it('reads the timepoint of the SR document with a Length to the manifest, and none from the control', () => {
    const tagged = read(file('length'));
    expect(timepointOf(tagged)).toEqual(expected(file('length')));
    expect(tagged.SeriesInstanceUID).toBe(files[file('length')].series_uid);
    expect(trackingUidsOf(tagged)).toEqual(files[file('length')].tracking_uids);
    expect(mockWarnings).toEqual([]);

    const control = read(file('length-none'));
    expect(timepointOf(control)).toBeNull();
    expect(trackingUidsOf(control)).toEqual(files[file('length-none')].tracking_uids);
  });

  it('reads the image the documents reference, which carries no timepoint', () => {
    const image = read(file('image'));
    expect(image.SOPInstanceUID).toBe(files[file('image')].sop_instance_uid);
    expect(timepointOf(image)).toBeNull();
    expect(read(file('length')).CurrentRequestedProcedureEvidenceSequence).toBeDefined();
  });
});

describe('the second pack', () => {
  it('reads every tagged document to the manifest, the series-level copies never deciding', () => {
    ['resave', 'conflict-r1', 'conflict-r2', 'join-r2', 'study-a', 'study-a-time', 'study-b', 'image-mpps-after'].forEach((topic) => {
      expect(timepointOf(read(file(topic)))).toEqual(expected(file(topic)));
    });
    ['join-r1', 'study-none', 'image-mpps-before'].forEach(topic => expect(timepointOf(read(file(topic)))).toBeNull());
    expect(mockWarnings).toEqual([]);
  });

  it('keeps the other item and the series-level values of the image beside the appended timepoint item', () => {
    const before = read(file('image-mpps-before'));
    const after = read(file('image-mpps-after'));
    const beforeItems = asArray(before.ReferencedPerformedProcedureStepSequence);
    const afterItems = asArray(after.ReferencedPerformedProcedureStepSequence);
    expect(afterItems).toHaveLength(beforeItems.length + 1);
    expect(afterItems.slice(0, beforeItems.length)).toEqual(beforeItems);
    expect(afterItems[afterItems.length - 1].ReferencedSOPClassUID).toBe(TIMEPOINT_CLASS_UID);
    ['PerformedProcedureStepID', 'PerformedProcedureStepDescription', 'PerformedProcedureStepStartDate', 'PerformedProcedureStepStartTime']
      .forEach(keyword => expect(after[keyword]).toEqual(before[keyword]));
  });

  it('uses the first of two timepoint items and warns', () => {
    expect(timepointOf(read(file('multiple-items')))).toEqual(expected(file('multiple-items')));
    expect(mockWarnings.some(line => line.includes(DIAGNOSTICS.MULTIPLE_ITEMS))).toBe(true);
  });

  it('gives no timepoint for an item without a UID, and warns', () => {
    expect(timepointOf(read(file('missing-uid')))).toBeNull();
    expect(mockWarnings.some(line => line.includes(DIAGNOSTICS.MISSING_UID))).toBe(true);
  });

  it('keeps an invalid date or time as text, warns, and counts it as absent in the order', () => {
    const invalidDate = timepointOf(read(file('invalid-date')));
    expect(invalidDate).toMatchObject({ ...files[file('invalid-date')].timepoint, dateValid: false, timeValid: true });
    const invalidTime = timepointOf(read(file('invalid-time')));
    expect(invalidTime).toMatchObject({ ...files[file('invalid-time')].timepoint, dateValid: true, timeValid: false });
    expect(mockWarnings.filter(line => line.includes(DIAGNOSTICS.INVALID_DATE))).toHaveLength(2);
    // Undated after dated; a time that is invalid sorts as no time
    const valid = timepointOf(read(file('length')));
    expect(compareTimepoints(valid, invalidDate)).toBeLessThan(0);
    expect(compareTimepoints(invalidTime, valid)).toBeLessThan(0);
  });

  it('orders the revisions of a series: the joining and the conflicting series end at their second revision in either order', () => {
    [['join-r1', 'join-r2'], ['conflict-r1', 'conflict-r2']].forEach(([first, second]) => {
      const r1 = read(file(first));
      const r2 = read(file(second));
      expect(r1.SeriesInstanceUID).toBe(r2.SeriesInstanceUID);
      [[r1, r2], [r2, r1]].forEach((order) => {
        expect(currentDocument(order.map(documentOrderOf)).SOPInstanceUID).toBe(r2.SOPInstanceUID);
      });
      expect(trackingUidsOf(r1)).toEqual(trackingUidsOf(r2));
    });
    const conflicting = ['conflict-r1', 'conflict-r2'].map(topic => timepointOf(read(file(topic))).uid);
    expect(conflicting[0]).not.toBe(conflicting[1]);
  });

  it('orders the shared cases of the manifest as the contract does, from any starting order', () => {
    const cases = manifest.order_cases;
    expect(cases.length).toBeGreaterThan(1);
    const expectedOrder = cases.map(entry => entry.uid);
    [cases.slice().reverse(), [...cases.slice(5), ...cases.slice(0, 5)], cases.slice().sort((a, b) => (a.uid < b.uid ? 1 : -1))].forEach((start) => {
      expect(start.slice().sort(compareTimepoints).map(entry => entry.uid)).toEqual(expectedOrder);
    });
  });

  it('orders the study\'s timepoints by the contract: the pre-operative one before the post-operative one', () => {
    const [postop, preop] = ['study-a', 'study-b'].map(topic => timepointOf(read(file(topic))));
    expect([postop, preop].sort(compareTimepoints).map(tp => tp.id)).toEqual(['TP-PREOP', 'TP-POSTOP-6W']);
    // Members that differ only in time
    const [a, aTime] = ['study-a', 'study-a-time'].map(topic => timepointOf(read(file(topic))));
    expect(a.uid).toBe(aTime.uid);
    expect(a.time).not.toBe(aTime.time);
  });
});
