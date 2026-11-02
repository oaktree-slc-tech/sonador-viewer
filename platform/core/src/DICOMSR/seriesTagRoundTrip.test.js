// Series Tag SR round trip against the legacy fixture written by an earlier viewer release
// (ohif-viewers#156): read the findings as the viewer hydrates them, write them through the legacy
// writer (adapter -> TID300 -> TID1500 -> extended meta and display attributes) and read the
// Part 10 bytes back.
//
// UPDATE_SR_FIXTURES=1 regenerates __fixtures__/series-tag.v1.dcm (the corrected output).

import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import { data as dcmjsData } from 'dcmjs';

jest.mock('@cornerstonejs/adapters', () => {
  class MeasurementReport {
    static registerTool(toolClass) {
      MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE[toolClass.utilityToolType] = toolClass;
    }
  }
  MeasurementReport.CORNERSTONE_TOOL_CLASSES_BY_TOOL_TYPE = {};

  // The parts of the pinned Cornerstone3D report and adapter base the Series Tag hydration uses.
  // codeValueMatch is the pinned implementation, which reads CodeValue only.
  class MeasurementReport3D {
    static registerTool(adapter) {
      MeasurementReport3D.measurementAdapterByToolType.set(adapter.toolType, adapter);
    }
    static getAdapterForTrackingIdentifier(trackingIdentifier) {
      return [...MeasurementReport3D.measurementAdapterByToolType.values()]
        .find(adapter => adapter.isValidCornerstoneTrackingIdentifier(trackingIdentifier));
    }
    static codeValueMatch(group, code, oldCode) {
      const sequence = group.ConceptNameCodeSequence;
      const item = Array.isArray(sequence) ? sequence[0] : sequence;
      return !!item && [code, oldCode].some(c => c && item.CodingSchemeDesignator == c.CodingSchemeDesignator
        && item.CodeValue == c.CodeValue);
    }
  }
  MeasurementReport3D.measurementAdapterByToolType = new Map();
  class BaseAdapter3D {
    static init(toolType, representation) {
      this.toolType = toolType;
      this.trackingIdentifiers = new Set();
      this.TID300Representation = representation;
      MeasurementReport3D.registerTool(this);
    }
    static registerLegacy() {
      this.trackingIdentifiers.add(`cornerstoneTools@^4.0.0:${this.toolType}`);
    }
    static isValidCornerstoneTrackingIdentifier(trackingIdentifier) {
      return this.trackingIdentifiers.has(trackingIdentifier);
    }
  }

  return {
    adaptersSR: {
      Cornerstone: { MeasurementReport },
      Cornerstone3D: {
        CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} },
        MeasurementReport: MeasurementReport3D,
        BaseAdapter3D,
      },
    },
    // As in the pinned package
    helpers: {
      toArray: x => (Array.isArray(x) ? x : x !== undefined ? [x] : []),
      codeMeaningEquals: meaning => contentItem => contentItem.ConceptNameCodeSequence.CodeMeaning === meaning,
    },
  };
}, { virtual: true });
jest.mock('../measurements/enums', () => {
  const Enums = {
    SREnums: jest.requireActual('./enums').Enums,
    SERVICE_EVENTS: { MEASUREMENTS_DATASYNC: 'datasync' },
    EVENTS: {},
    Cornerstone3D: { sr: {} },
  };
  Object.defineProperty(Enums.Cornerstone3D.sr, 'measurementReport', {
    get: () => jest.requireActual('./Cornerstone3d/MeasurementReport').default,
  });
  return { __esModule: true, default: Enums, Enums };
});
jest.mock('../measurements/classes', () => ({
  MeasurementApi: {
    Instance: { measurementService: { _broadcastEvent: () => {} } },
    _unpackMeasurementData: measurement => ({
      measurementMeta: measurement.metadata || measurement,
      measurementData: measurement.data || measurement.measurementData || measurement,
    }),
  },
}));

import { readFindingCode } from './TID300/DICOMReferencedSOPInstanceFinding';
import { findReferencedSOPSequence } from './Cornerstone3d/utils/findReferencedSOP';
import { asArray, conceptNameValue, firstItem } from './utils/codedConcept';
import { encodeDisplayAttributes, parseDisplayAttributes } from './utils/dcmsrDisplayAttributes';
import { encodeExtendedMeta, parseExtendedMeta } from './utils/dcmsrExtendedMeta';
import { SonadorCodeValues } from './enums';

const { DicomDict, DicomMessage, DicomMetaDictionary } = dcmjsData;

const FIXTURES = path.join(__dirname, '__fixtures__');
const LEGACY = path.join(FIXTURES, 'series-tag.legacy.dcm');
const V1 = path.join(FIXTURES, 'series-tag.v1.dcm');

const TOOL_TYPE = 'DICOMSRSeriesTagTool';
const CODES = {
  ImagingMeasurements: '126010', MeasurementGroup: '125007', Finding: '121071', TrackingUniqueIdentifier: '112040',
};
const EXTENDED_META = ['DCMSR_MEASUREMENT_DESCRIPTION', 'DCMSR_MEASUREMENT_TEXT', 'DCMSR_MEASUREMENT_LOCATION']
  .map(key => SonadorCodeValues[key].value);

// The SR document attributes a viewer save copies from the source study
const DOCUMENT_ATTRIBUTES = [
  'PatientName', 'PatientID', 'PatientBirthDate', 'PatientSex', 'StudyInstanceUID', 'StudyDate', 'StudyTime',
  'StudyID', 'AccessionNumber', 'ReferringPhysicianName', 'SeriesDescription', 'SeriesNumber', 'Manufacturer',
];

let MeasurementReport;
let MeasurementReport3D;
beforeAll(() => {
  // The legacy adapter module relies on the lodash global the viewer bundle provides
  global._ = _;
  require('./SCOORD3D/adapters');
  MeasurementReport = require('./SCOORD3D/MeasurementReport').default;
  require('./Cornerstone3d/adapters');
  MeasurementReport3D = require('./Cornerstone3d/MeasurementReport').default;
});
afterAll(() => {
  delete global._;
});


const readSR = buffer => {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(arrayBuffer).dict);
};

const child = (item, code) => asArray(item && item.ContentSequence).find(c => conceptNameValue(c) === code);
const measurementGroups = dataset => asArray(child(dataset, CODES.ImagingMeasurements).ContentSequence)
  .filter(item => conceptNameValue(item) === CODES.MeasurementGroup);
const trackingUIDOf = group => child(group, CODES.TrackingUniqueIdentifier).UID;
const findingOf = group => child(group, CODES.Finding);
const findingCodeOf = group => firstItem(findingOf(group).ConceptCodeSequence);
const imageOf = group => asArray(findingOf(group).ContentSequence).find(item => item.ValueType === 'IMAGE');
const extendedMetaOf = group => asArray(group.ContentSequence)
  .filter(item => EXTENDED_META.includes(conceptNameValue(item)))
  .map(item => ({ code: firstItem(item.ConceptNameCodeSequence), value: item.TextValue }));
const colorsOf = group => {
  const display = child(group, SonadorCodeValues.DCMSR_DISPLAY_ATTRIBUTES.value);
  const color = child(display, SonadorCodeValues.DCMSR_DISPLAY_COLOR.value);
  return asArray(color.ContentSequence).map(item => [conceptNameValue(item), item.TextValue]);
};


function hydrate(group, index) {
  // The tool data the legacy annotation mapping hands to the writer for a finding read from an SR
  const TrackingUniqueIdentifier = trackingUIDOf(group);
  const code = readFindingCode(findingOf(group), TrackingUniqueIdentifier);

  const state = { annotation: { metadata: {}, data: {} } };
  parseExtendedMeta(group, state);
  parseDisplayAttributes(group, state);
  const { text, location } = state.annotation.metadata;

  return {
    _id: `finding-${index}`,
    uid: `measurement-${index}`,
    value: code.value,
    text: text || code.text,
    description: state.description,
    displayAttributes: state.annotation.data.displayAttributes,
    metadata: {
      scheme: code.scheme, schemeVersion: code.schemeVersion, TrackingUniqueIdentifier, text, location,
    },
    reference: findReferencedSOPSequence(findingOf(group)),
  };
}


function writeSR(source, tools) {
  // Write the tools through the legacy writer, as a viewer save does, and return the Part 10 bytes
  const [{ reference }] = tools;
  const imageId = `wadors:${reference.ReferencedSOPInstanceUID}`;
  const evidence = firstItem(source.CurrentRequestedProcedureEvidenceSequence);
  const metadataProvider = {
    get: (type) => ({
      generalSeriesModule: {
        studyInstanceUID: source.StudyInstanceUID,
        seriesInstanceUID: firstItem(evidence.ReferencedSeriesSequence).SeriesInstanceUID,
      },
      sopCommonModule: { sopClassUID: reference.ReferencedSOPClassUID, sopInstanceUID: reference.ReferencedSOPInstanceUID },
    })[type],
  };

  const toolState = { [imageId]: { [TOOL_TYPE]: { data: tools.map(tool => _.omit(tool, 'reference')) } } };
  const report = MeasurementReport.generateReport(toolState, metadataProvider, {
    onContentItemCreate: (toolType, { _id }, tid300Measurement, srItem) => {
      const measurement = tools.find(tool => tool._id === _id);
      encodeExtendedMeta(measurement, srItem);
      encodeDisplayAttributes(measurement, srItem);
    },
  });

  const dataset = _.extend(_.omit(report.dataset, '_meta', '_vrMap'), _.pick(source, DOCUMENT_ATTRIBUTES));
  const meta = _.extend({}, report.dataset._meta, {
    MediaStorageSOPClassUID: { Value: [dataset.SOPClassUID], vr: 'UI' },
    MediaStorageSOPInstanceUID: { Value: [dataset.SOPInstanceUID], vr: 'UI' },
  });
  const dicomDict = new DicomDict(meta);
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(JSON.parse(JSON.stringify(dataset)));
  return Buffer.from(dicomDict.write());
}


describe('legacy Series Tag fixture', () => {
  const legacy = readSR(fs.readFileSync(LEGACY));
  const legacyGroups = measurementGroups(legacy);

  it('hydrates both findings with their own identity, reference, metadata and colours', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [first, second] = legacyGroups.map(hydrate);
    warn.mockRestore();

    expect(legacyGroups).toHaveLength(2);
    expect(first.metadata.TrackingUniqueIdentifier).toBe('2.25.810839409582656272888045085434576840833');
    expect(second.metadata.TrackingUniqueIdentifier).toBe('2.25.259161114598460130268782036364529896765');

    expect(_.pick(first, 'value', 'text', 'description')).toEqual({
      value: 'img-qc.reject', text: 'Image Rejected',
      description: 'MR images rejected due to metal artifact and motion blur.',
    });
    expect(first.metadata).toMatchObject({ scheme: 'Sonador-SEG', schemeVersion: undefined });
    expect(_.pick(second, 'value', 'text', 'description')).toEqual({
      value: 'img-qc.metal-artifact', text: 'Metal Artifact', description: undefined,
    });
    expect(second.metadata).toMatchObject({ scheme: 'Visionaire-QC', schemeVersion: '0.2', location: 'Bone' });

    expect(first.reference.ReferencedSOPInstanceUID).toBe(second.reference.ReferencedSOPInstanceUID);
    expect(first.reference.ReferencedFrameNumber).toBeUndefined();
    expect(first.displayAttributes.Color).toEqual(expect.objectContaining({ Border: expect.any(String) }));
    expect(second.displayAttributes.Color).toEqual(expect.objectContaining({ Meaning: expect.any(String) }));
  });

  it('drops only the malformed version, with a diagnostic naming the tracking UID', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [first, second] = legacyGroups.map(group => readFindingCode(findingOf(group), trackingUIDOf(group)));

    expect(first.schemeVersion).toBeUndefined();
    expect(second.schemeVersion).toBe('0.2');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('2.25.810839409582656272888045085434576840833');
    warn.mockRestore();
  });
});


describe('re-saving the legacy fixture', () => {
  const legacy = readSR(fs.readFileSync(LEGACY));
  const legacyGroups = measurementGroups(legacy);

  const resave = edit => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = legacyGroups.map(hydrate);
    warn.mockRestore();
    edit(tools);
    return { tools, bytes: writeSR(legacy, tools) };
  };

  it('edits one description without a catalogue lookup and keeps everything else', () => {
    const { bytes } = resave(([first]) => {
      first.description = 'Rejected: metal artifact.';
    });
    const groups = measurementGroups(readSR(bytes));

    expect(groups.map(trackingUIDOf)).toEqual(legacyGroups.map(trackingUIDOf));
    expect(groups.map(group => imageOf(group).ReferencedSOPSequence))
      .toEqual(legacyGroups.map(group => imageOf(group).ReferencedSOPSequence));
    expect(groups.map(colorsOf)).toEqual(legacyGroups.map(colorsOf));

    // The malformed version is not re-emitted and not replaced; the valid one is kept
    expect(findingCodeOf(groups[0])).not.toHaveProperty('CodingSchemeVersion');
    expect(findingCodeOf(groups[1]).CodingSchemeVersion).toBe('0.2');

    const metaValues = group => extendedMetaOf(group).map(({ code, value }) => [code.LongCodeValue, value]);
    expect(metaValues(groups[0])).toEqual([
      [SonadorCodeValues.DCMSR_MEASUREMENT_DESCRIPTION.value, 'Rejected: metal artifact.'],
      [SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value, 'Image Rejected'],
    ]);
    expect(metaValues(groups[1])).toEqual([
      [SonadorCodeValues.DCMSR_MEASUREMENT_TEXT.value, 'Metal Artifact'],
      [SonadorCodeValues.DCMSR_MEASUREMENT_LOCATION.value, 'Bone'],
    ]);
  });

  it('writes the relationships, the long code values and the meanings as entered', () => {
    const { bytes } = resave(() => {});
    const groups = measurementGroups(readSR(bytes));

    groups.forEach(group => {
      expect(findingOf(group).RelationshipType).toBe('CONTAINS');
      expect(imageOf(group).RelationshipType).toBe('INFERRED FROM');
    });

    expect(findingCodeOf(groups[0])).toMatchObject({ CodeValue: 'img-qc.reject', CodeMeaning: 'Image Rejected' });
    expect(findingCodeOf(groups[1])).toMatchObject({ LongCodeValue: 'img-qc.metal-artifact', CodeMeaning: 'Metal Artifact' });
    expect(findingCodeOf(groups[1])).not.toHaveProperty('CodeValue');

    // Extended meta names move to LongCodeValue; their meanings are byte-identical to the legacy file
    const legacyMeanings = _.fromPairs(_.flatMap(legacyGroups, group =>
      extendedMetaOf(group).map(({ code }) => [code.CodeValue, code.CodeMeaning])));
    groups.forEach(group => extendedMetaOf(group).forEach(({ code }) => {
      expect(code.CodeValue).toBeUndefined();
      expect(code.CodeMeaning).toBe(legacyMeanings[code.LongCodeValue]);
    }));
  });

  it('writes a catalogue meaning of any length verbatim and reads it back', () => {
    const meaning = 'Metal artifact '.repeat(8).trim();
    const { bytes } = resave(([, second]) => {
      second.text = meaning;
      second.metadata.text = meaning;
    });
    const [, group] = measurementGroups(readSR(bytes));

    expect(meaning.length).toBeGreaterThan(64);
    expect(findingCodeOf(group).CodeMeaning).toBe(meaning);
    expect(readFindingCode(findingOf(group)).text).toBe(meaning);
  });

  it('re-applying the catalogue tags writes their versions (the v1 fixture)', () => {
    const { bytes } = resave(([first]) => {
      first.metadata.schemeVersion = '0.2';
    });
    if (process.env.UPDATE_SR_FIXTURES) {
      fs.writeFileSync(V1, bytes);
    }
    const groups = measurementGroups(readSR(bytes));
    expect(groups.map(group => findingCodeOf(group).CodingSchemeVersion)).toEqual(['0.2', '0.2']);
  });
});


describe('scheme version of a selected tag', () => {
  // The writer receives the version the annotation mapping resolves: the tag's own on selection,
  // null once an unversioned tag replaces a versioned one (utils.dataProc.firstPresentValue).
  const legacy = readSR(fs.readFileSync(LEGACY));

  const versionsWritten = schemeVersions => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = measurementGroups(legacy).map(hydrate);
    warn.mockRestore();
    tools.forEach((tool, idx) => {
      tool.metadata.schemeVersion = schemeVersions[idx];
    });
    return measurementGroups(readSR(writeSR(legacy, tools))).map(group => findingCodeOf(group).CodingSchemeVersion);
  };

  it('writes the version of a versioned tag', () => {
    expect(versionsWritten(['0.2', '1.0'])).toEqual(['0.2', '1.0']);
  });

  it('omits the attribute for a tag without a version, and when a versioned tag is replaced by one', () => {
    expect(versionsWritten([undefined, null])).toEqual([undefined, undefined]);
  });

  it('never substitutes a registry constant', () => {
    expect(versionsWritten([undefined, undefined])).not.toContain('0.3');
  });
});


function hydrateWithCornerstone3D(dataset) {
  // The production hydration: Cornerstone3D generateToolState and the Series Tag adapter, with the
  // extended meta and display attribute hook parseDicomStructuredReport installs
  const sopInstanceUIDs = _.uniq(measurementGroups(readSR(fs.readFileSync(LEGACY)))
    .map(group => imageOf(group).ReferencedSOPSequence.ReferencedSOPInstanceUID));
  const imageIds = _.fromPairs(sopInstanceUIDs.map(uid => [uid, `wadors:${uid}`]));

  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const toolState = MeasurementReport3D.generateToolState(dataset, imageIds, { get: () => undefined }, undefined, {
      onContentItemParse: (toolType, annotation, srItem) => {
        parseExtendedMeta(srItem, annotation);
        parseDisplayAttributes(srItem, annotation);
      },
    });
    return { findings: toolState[TOOL_TYPE] || [], warnings: warn.mock.calls };
  } finally {
    log.mockRestore();
    debug.mockRestore();
    warn.mockRestore();
  }
}

const CODE_SEQUENCES = ['ConceptNameCodeSequence', 'ConceptCodeSequence'];

function rewriteCodes(node, rewrite) {
  // Apply `rewrite` to every concept name / concept code sequence in a naturalized dataset
  if (_.isArray(node)) {
    node.forEach(item => rewriteCodes(item, rewrite));
  } else if (_.isPlainObject(node)) {
    Object.keys(node).forEach(key => {
      if (CODE_SEQUENCES.includes(key) && node[key]) {
        node[key] = rewrite(key, node[key]);
      } else {
        rewriteCodes(node[key], rewrite);
      }
    });
  }
  return node;
}

const toLongCodeValue = (key, sequence) => {
  const code = { ...firstItem(sequence) };
  if (key === 'ConceptNameCodeSequence' && code.CodeValue) {
    code.LongCodeValue = code.CodeValue;
    delete code.CodeValue;
  }
  return code;
};
const toPlainArray = (key, sequence) => [{ ...firstItem(sequence) }];


describe('Cornerstone3D hydration', () => {
  const expectFindings = ({ findings, warnings }, schemeVersions) => {
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.TrackingUniqueIdentifier)).toEqual([
      '2.25.810839409582656272888045085434576840833', '2.25.259161114598460130268782036364529896765']);
    expect(findings.map(f => f.annotation.metadata.TrackingUniqueIdentifier))
      .toEqual(findings.map(f => f.TrackingUniqueIdentifier));
    expect(findings.map(f => f.annotation.data.value)).toEqual(['img-qc.reject', 'img-qc.metal-artifact']);
    expect(findings.map(f => f.annotation.data.text)).toEqual(['Image Rejected', 'Metal Artifact']);
    expect(findings.map(f => f.annotation.metadata.scheme)).toEqual(['Sonador-SEG', 'Visionaire-QC']);
    expect(findings.map(f => f.annotation.metadata.schemeVersion)).toEqual(schemeVersions);
    expect(_.uniq(findings.map(f => f.sopInstanceUid))).toHaveLength(1);
    expect(findings[0].description).toBe('MR images rejected due to metal artifact and motion blur.');
    expect(findings[1].annotation.metadata.location).toBe('Bone');
    findings.forEach(f => expect(f.annotation.data.displayAttributes.Color).toBeDefined());
    expect(warnings.filter(([message]) => /Unable to generate tool state/.test(message))).toEqual([]);
  };

  it('hydrates the legacy fixture', () => {
    expectFindings(hydrateWithCornerstone3D(readSR(fs.readFileSync(LEGACY))), [undefined, '0.2']);
  });

  it('hydrates the v1 fixture', () => {
    expectFindings(hydrateWithCornerstone3D(readSR(fs.readFileSync(V1))), ['0.2', '0.2']);
  });

  it('matches concept names written as LongCodeValue (report, group, tracking and finding codes)', () => {
    const dataset = rewriteCodes(readSR(fs.readFileSync(V1)), toLongCodeValue);
    expect(firstItem(findingOf(measurementGroups(dataset)[0]).ConceptNameCodeSequence).LongCodeValue).toBe('121071');
    expectFindings(hydrateWithCornerstone3D(dataset), ['0.2', '0.2']);
  });

  it('matches code sequences naturalized as plain one-item arrays', () => {
    const dataset = rewriteCodes(readSR(fs.readFileSync(V1)), toPlainArray);
    expectFindings(hydrateWithCornerstone3D(dataset), ['0.2', '0.2']);
  });

  it('does not match a code with the same value from a different scheme', () => {
    const dataset = rewriteCodes(readSR(fs.readFileSync(V1)), (key, sequence) => {
      const code = { ...firstItem(sequence) };
      if (key === 'ConceptNameCodeSequence' && code.CodeValue === CODES.Finding) {
        code.CodingSchemeDesignator = '99LOCAL';
      }
      return code;
    });
    expect(hydrateWithCornerstone3D(dataset).findings).toHaveLength(0);
  });
});


describe('corrected Series Tag fixture (v1)', () => {
  it('hydrates as written, with no diagnostic', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const [first, second] = measurementGroups(readSR(fs.readFileSync(V1))).map(hydrate);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    expect(first).toMatchObject({ value: 'img-qc.reject', metadata: { schemeVersion: '0.2' } });
    expect(second).toMatchObject({ value: 'img-qc.metal-artifact', metadata: { schemeVersion: '0.2', location: 'Bone' } });
    expect(first.metadata.TrackingUniqueIdentifier).toBe('2.25.810839409582656272888045085434576840833');
    expect(second.metadata.TrackingUniqueIdentifier).toBe('2.25.259161114598460130268782036364529896765');
  });
});
