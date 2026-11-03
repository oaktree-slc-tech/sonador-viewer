jest.mock('@cornerstonejs/adapters', () => ({
  adaptersSR: { Cornerstone3D: { CodeScheme: { CodingSchemeDesignator: 'CORNERSTONEJS', codeValues: {} } } },
}), { virtual: true });

import {
  applyRootContent,
  clearHydratedReports,
  documentSettings,
  personObserverName,
  registerHydratedReport,
  requiresComprehensive,
  resolvePersonObserverName,
  saveParent,
} from './srDocument';
import { conceptNameValue } from './codedConcept';

const ENHANCED_SR = '1.2.840.10008.5.1.4.1.1.88.22';
const COMPREHENSIVE_SR = '1.2.840.10008.5.1.4.1.1.88.33';
const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';

const report = (SOPInstanceUID, SOPClassUID, TemplateIdentifier, MappingResource, StudyInstanceUID = '2.25.1') => ({
  StudyInstanceUID, SeriesInstanceUID: `${SOPInstanceUID}.1`, SOPInstanceUID, SOPClassUID,
  ContentTemplateSequence: [{ TemplateIdentifier, MappingResource }],
});


describe('documentSettings', () => {
  it('writes a new document as Comprehensive 3D SR with the Sonador template', () => {
    expect(documentSettings(null)).toEqual({
      documentClass: 'Comprehensive3DSR',
      template: { TemplateIdentifier: 'Sonador-SR.1500', MappingResource: 'Sonador-SR' },
    });
  });

  it("keeps an Enhanced SR parent's class and template", () => {
    expect(documentSettings({ SOPClassUID: ENHANCED_SR, TemplateIdentifier: '1500', MappingResource: 'DCMR' })).toEqual({
      documentClass: 'EnhancedSR', template: { TemplateIdentifier: '1500', MappingResource: 'DCMR' },
    });
  });

  it('writes any other parent as Comprehensive 3D SR with its template', () => {
    [COMPREHENSIVE_SR, COMPREHENSIVE_3D_SR].forEach(SOPClassUID => {
      expect(documentSettings({ SOPClassUID, TemplateIdentifier: '1500', MappingResource: 'DCMR' })).toEqual({
        documentClass: 'Comprehensive3DSR', template: { TemplateIdentifier: '1500', MappingResource: 'DCMR' },
      });
    });
  });
});


describe('saveParent', () => {
  afterEach(clearHydratedReports);

  it('is the single SR hydrated for the study, and none when there are several or none', () => {
    expect(saveParent('2.25.1')).toBeNull();

    registerHydratedReport(report('2.25.10', ENHANCED_SR, '1500', 'DCMR'));
    registerHydratedReport(report('2.25.10', ENHANCED_SR, '1500', 'DCMR'));
    registerHydratedReport(report('2.25.20', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500', 'Sonador-SR', '2.25.2'));
    expect(saveParent('2.25.1')).toMatchObject({ SOPInstanceUID: '2.25.10', TemplateIdentifier: '1500', MappingResource: 'DCMR' });

    registerHydratedReport(report('2.25.11', COMPREHENSIVE_3D_SR, 'Sonador-SR.1500', 'Sonador-SR'));
    expect(saveParent('2.25.1')).toBeNull();
    expect(saveParent('2.25.2')).toMatchObject({ SOPClassUID: COMPREHENSIVE_3D_SR });
  });
});


describe('Person Observer', () => {
  it('is the DICOM person name of the Sonador user, or the username', () => {
    expect(personObserverName({ first_name: 'Ada', last_name: 'Lovelace', username: 'ada' })).toBe('Lovelace^Ada');
    expect(personObserverName({ last_name: 'Lovelace' })).toBe('Lovelace');
    expect(personObserverName({ first_name: ' ', last_name: '', username: 'ada' })).toBe('ada');
    expect(personObserverName({})).toBeNull();
    expect(personObserverName(undefined)).toBeNull();
  });

  it("resolves from the server's cached /system report, fetching it when no consumer has", async () => {
    const cached = { sysInfo: { User: { first_name: 'Ada', last_name: 'Lovelace' } } };
    const fetchSystemInfo = jest.fn();
    expect(await resolvePersonObserverName(cached, fetchSystemInfo)).toBe('Lovelace^Ada');
    expect(fetchSystemInfo).not.toHaveBeenCalled();

    const server = { rootUrl: 'https://imaging.example' };
    fetchSystemInfo.mockResolvedValue({ ok: true, json: () => Promise.resolve({ User: { username: 'ada' } }) });
    expect(await resolvePersonObserverName(server, fetchSystemInfo)).toBe('ada');
    expect(server.sysInfo.User.username).toBe('ada');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resolvePersonObserverName({ rootUrl: 'x' }, () => Promise.reject(new Error('offline')))).toBeNull();
    warn.mockRestore();
    expect(await resolvePersonObserverName(null)).toBeNull();
  });
});


describe('applyRootContent', () => {
  const content = () => ({
    ContentTemplateSequence: { MappingResource: 'DCMR', TemplateIdentifier: '1500' },
    ContentSequence: [
      { ConceptNameCodeSequence: { CodeValue: '121049', CodingSchemeDesignator: 'DCM' } },
      { ConceptNameCodeSequence: { CodeValue: '121008', CodingSchemeDesignator: 'DCM' }, PersonName: 'unknown^unknown' },
      { ConceptNameCodeSequence: { CodeValue: '121058', CodingSchemeDesignator: 'DCM' } },
    ],
  });

  it('sets the template and replaces the placeholder person with the observation context', () => {
    const root = applyRootContent(content(), { personName: 'Lovelace^Ada', deviceObserverUID: '2.25.9' });
    expect(root.ContentTemplateSequence).toEqual([{ MappingResource: 'Sonador-SR', TemplateIdentifier: 'Sonador-SR.1500' }]);
    expect(root.ContentSequence.map(conceptNameValue))
      .toEqual(['121049', '121008', '121005', '121012', '121013', '121014', '121015', '121058']);
    expect(root.ContentSequence[1].PersonName).toBe('Lovelace^Ada');
    expect(root.ContentSequence[3].UID).toBe('2.25.9');
  });

  it("keeps a re-save's template and drops the person when the session names nobody", () => {
    const root = applyRootContent(content(), { template: { TemplateIdentifier: '1500', MappingResource: 'DCMR' } });
    expect(root.ContentTemplateSequence).toEqual([{ MappingResource: 'DCMR', TemplateIdentifier: '1500' }]);
    expect(root.ContentSequence.map(conceptNameValue)).not.toContain('121008');
  });
});


describe('requiresComprehensive', () => {
  const tree = children => ({ ValueType: 'CONTAINER', ContentSequence: children });

  it('is true for an SCOORD3D item or a CONTAINER under a CODE or NUM item', () => {
    expect(requiresComprehensive(tree([{ ValueType: 'NUM', ContentSequence: [{ ValueType: 'SCOORD3D' }] }]))).toBe(true);
    expect(requiresComprehensive(tree([{ ValueType: 'CODE', ContentSequence: [{ ValueType: 'CONTAINER' }] }]))).toBe(true);
    expect(requiresComprehensive(tree([{ ValueType: 'NUM', ContentSequence: [{ ValueType: 'CONTAINER' }] }]))).toBe(true);
  });

  it('is false for the flat Series-Tag form and for SCOORD under NUM', () => {
    expect(requiresComprehensive(tree([tree([{ ValueType: 'CODE', ContentSequence: [{ ValueType: 'IMAGE' }, { ValueType: 'TEXT' }] }])]))).toBe(false);
    expect(requiresComprehensive(tree([{ ValueType: 'NUM', ContentSequence: [{ ValueType: 'SCOORD' }] }]))).toBe(false);
  });
});
