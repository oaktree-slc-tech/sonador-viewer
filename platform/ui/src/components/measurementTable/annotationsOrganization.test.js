// The Annotations drawer's search and Group by series: a row matches when every typed word is in
// one of its fields (type, label, location, description, modality, series description); groups
// keep their matching rows and totals, and lose their place while nothing matches; grouped by
// series, rows split by series in series-number order, the unresolved ones last.

const mockSeries = {
  '2.25.21': { SeriesNumber: 12, Modality: 'MR', SeriesDescription: 'Sag T2 FSE' },
  '2.25.22': { SeriesNumber: 3, Modality: 'CT', SeriesDescription: 'Axial Bone' },
};
jest.mock('@ohif/core', () => ({
  __esModule: true,
  default: {
    DicomMetadataStore: { getSeries: (study, series) => (series === '2.25.21' ? { instances: [{}, {}, {}] } : undefined) },
    utils: { referenceIdentifiers: (store, { SeriesInstanceUID }) => mockSeries[SeriesInstanceUID] || null },
    measurements: {
      MeasurementApi: {
        getConfiguration: () => ({ measurementTools: [{ childTools: [
          { id: 'CobbAngle', name: 'Cobb Angle' }, { id: 'Length', name: 'Length' }, { id: 'Bidirectional', name: 'Target' },
        ] }] }),
      },
    },
  },
}), { virtual: true });

import {
  filterGroups, groupRowsBySeries, matchesQuery, seriesAnnotationTypes, seriesEntries, seriesHeading, rowSearchText, rowToolType, seriesTitle, toolTypeNames, trackedToolType,
  UNAVAILABLE_HELP, UNAVAILABLE_KEY, UNAVAILABLE_LABEL,
} from './annotationsOrganization';

const row = (id, extra = {}) => ({ measurementId: id, toolType: 'Length', ...extra });
const cobb = row('c1', { toolType: 'CobbAngle', label: 'Lumbar spine', location: 'Lumbar spine', description: 'Pre-op', refSeriesInstanceUID: '2.25.21' });
const length = row('l1', { label: 'Femur', refSeriesInstanceUID: '2.25.22' });
const arrow = row('a1', { toolType: 'ArrowAnnotate', description: 'Screw tip', refSeriesInstanceUID: '2.25.99' });
const tag = row('t1', { toolType: 'DICOMSRSeriesTagTool', seriesTagDisplay: { value: 'Pre-operative', meaning: 'Planning' } });

it('knows a type by its configured name, its readable id and an alias', () => {
  expect(toolTypeNames('CobbAngle')).toEqual(['Cobb Angle', 'Cobb Angle']);
  expect(toolTypeNames('ArrowAnnotate')).toEqual(['Arrow Annotate', 'Arrow Annotation']);
  expect(toolTypeNames('DICOMSRSeriesTagTool')).toContain('Series Tag');
});

it('searches a measurement read from a report by the tool it was drawn with', () => {
  const reported = row('r1', { toolType: 'DICOMSRDisplayTool', trackingIdentifier: 'cornerstoneTools@^4.0.0:Length' });
  expect(rowToolType(reported)).toBe('Length');
  expect(matchesQuery(reported, 'length')).toBe(true);
  expect(matchesQuery(row('r2', { toolType: 'DICOMSRDisplayTool', trackingIdentifier: 'Cornerstone3DTools@^0.1.0:CobbAngle' }), 'cobb angle')).toBe(true);
  expect(trackedToolType('no-colon')).toBeUndefined();
  expect(matchesQuery(row('l2'), 'length')).toBe(true);
});

it('finds a Bidirectional by its configured name and its tool name, drawn, out-of-plane or read from a report', () => {
  expect(toolTypeNames('Bidirectional')).toEqual(['Target', 'Bidirectional']);
  const drawn = row('b1', { toolType: 'Bidirectional', label: 'Liver lesion' });
  expect(matchesQuery(drawn, 'target')).toBe(true);
  expect(matchesQuery(drawn, 'bidirectional liver')).toBe(true);
  const reported = row('b2', { toolType: 'DICOMSRDisplayTool', trackingIdentifier: 'cornerstoneTools@^4.0.0:Bidirectional' });
  expect(rowToolType(reported)).toBe('Bidirectional');
  expect(matchesQuery(reported, 'bidirectional')).toBe(true);
});

it('searches the type, label, location, description, modality and series description', () => {
  const text = rowSearchText(cobb);
  ['cobb angle', 'lumbar spine', 'pre-op', 'mr', 'sag t2 fse'].forEach(field => expect(text).toContain(field));
  expect(rowSearchText(tag)).toContain('pre-operative');
});

it('matches when every word appears, in any field and case', () => {
  expect(matchesQuery(cobb, 'COBB lumbar')).toBe(true);
  expect(matchesQuery(cobb, 'cobb femur')).toBe(false);
  expect(matchesQuery(length, 'ct bone')).toBe(true);
  expect(matchesQuery(arrow, 'arrow annotation screw')).toBe(true);
  expect(matchesQuery(cobb, '   ')).toBe(true);
});

it('keeps the matching rows of each group with its total, and leaves out groups without a match', () => {
  const groups = [
    { groupId: 'measurements', measurements: [cobb, length] },
    { groupId: 'findings', measurements: [tag] },
  ];
  expect(filterGroups(groups, 'mr')).toEqual([{ groupId: 'measurements', totalCount: 2, measurements: [cobb] }]);
  expect(filterGroups(groups, '').map(group => [group.groupId, group.measurements.length, group.totalCount]))
    .toEqual([['measurements', 2, 2], ['findings', 1, 1]]);
  expect(filterGroups(groups, 'nothing here')).toEqual([]);
});

it('splits rows by series in series-number order, headed by the description, the unresolved ones last', () => {
  const groups = groupRowsBySeries([cobb, arrow, length, tag]);
  expect(groups.map(group => [group.key, group.label, group.measurements.map(m => m.measurementId)])).toEqual([
    ['2.25.22', 'Axial Bone', ['l1']],
    ['2.25.21', 'Sag T2 FSE', ['c1']],
    [UNAVAILABLE_KEY, UNAVAILABLE_LABEL, ['a1', 't1']],
  ]);
  // The card's details: series number, modality and instance count (when the store has the series)
  expect(groups[1]).toMatchObject({ seriesNumber: 12, modality: 'MR', instanceCount: 3 });
  expect(groups[0]).toMatchObject({ seriesNumber: 3, modality: 'CT', instanceCount: undefined });
  expect(groups[2].help).toBe(UNAVAILABLE_HELP);
  expect(UNAVAILABLE_LABEL).toBe('Series Unavailable');
  expect(groupRowsBySeries([cobb]).map(group => group.key)).toEqual(['2.25.21']);
});

it('heads a series by its description, else its number, else its modality', () => {
  expect(seriesTitle({ SeriesNumber: 4, Modality: 'DX', SeriesDescription: ' Localizer ' })).toBe('Localizer');
  expect(seriesTitle({ SeriesNumber: 0, Modality: 'MR', SeriesDescription: '' })).toBe('Series 0');
  expect(seriesTitle({ Modality: 'CT' })).toBe('CT');
  expect(seriesTitle({})).toBe('Unnamed Series');
  // A generated heading gives its translation key and values; a description or modality does not
  expect(seriesHeading({ SeriesNumber: 0 })).toEqual({ label: 'Series 0', labelKey: 'Series {{number}}', labelValues: { number: 0 } });
  expect(seriesHeading({})).toEqual({ label: 'Unnamed Series', labelKey: 'Unnamed Series' });
  expect(seriesHeading({ SeriesDescription: 'Localizer', SeriesNumber: 4 })).toEqual({ label: 'Localizer' });
  expect(groupRowsBySeries([row('x1')])[0]).toMatchObject({ label: UNAVAILABLE_LABEL, labelKey: UNAVAILABLE_LABEL });
});

it("lists a series' annotation types from the API's by-series query, saved first, the pending ones apart", () => {
  const entry = (toolType, pending = false) => ({ toolType, pending, studyInstanceUID: '2.25.1' });
  const bySeries = new Map([
    ['2.25.21', [entry('Length'), entry('CobbAngle'), entry('Length'), entry('DICOMSRSeriesTagTool'), entry('Length', true), entry('Angle', true), entry('Length', true)]],
    ['2.25.99', [entry('ArrowAnnotate')]],
    [null, [entry('DICOMSRSeriesTagTool')]],
  ]);
  const line = (name, toolType, pending, count) => ({ name, toolType, outOfPlane: false, pending, count });
  expect(seriesAnnotationTypes(seriesEntries(bySeries, '2.25.21'))).toEqual([
    line('Length', 'Length', false, 2),
    line('Cobb Angle', 'CobbAngle', false, 1),
    line('Series Tag', 'DICOMSRSeriesTagTool', false, 1),
    line('Length', 'Length', true, 2),
    line('Angle', 'Angle', true, 1),
  ]);
  // Series Unavailable: the measurements without a series and those of a series the store does not know
  expect(seriesAnnotationTypes(seriesEntries(bySeries, UNAVAILABLE_KEY)))
    .toEqual([line('Arrow Annotation', 'ArrowAnnotate', false, 1), line('Series Tag', 'DICOMSRSeriesTagTool', false, 1)]);
  expect(seriesEntries(undefined, '2.25.21')).toEqual([]);
});


it('searches the view of an out-of-plane measurement', () => {
  const sagittal = row('o1', { toolType: 'CobbAngle', outOfPlane: { view: 'Sagittal', viewName: 'sagittal' }, refSeriesInstanceUID: '2.25.22' });
  expect(matchesQuery(sagittal, 'sagittal')).toBe(true);
  expect(matchesQuery(sagittal, 'cobb sagittal')).toBe(true);
  expect(matchesQuery(row('o2', { outOfPlane: { view: 'Oblique' } }), 'sagittal')).toBe(false);
  expect(matchesQuery(length, 'sagittal')).toBe(false);
});

it('counts out-of-plane measurements as a type of their own on the series card, flagged for its 3D mark', () => {
  const entries = [
    { toolType: 'Length' }, { toolType: 'Length', outOfPlane: true }, { toolType: 'Length', outOfPlane: true },
    { toolType: 'CobbAngle', outOfPlane: true, pending: true },
  ];
  expect(seriesAnnotationTypes(entries)).toEqual([
    { name: 'Length', toolType: 'Length', outOfPlane: true, pending: false, count: 2 },
    { name: 'Length', toolType: 'Length', outOfPlane: false, pending: false, count: 1 },
    { name: 'Cobb Angle', toolType: 'CobbAngle', outOfPlane: true, pending: true, count: 1 },
  ]);
});

