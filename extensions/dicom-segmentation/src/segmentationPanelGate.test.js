// The Segmentations panel tab: offered for SEG studies, STL model studies, and the open editor

import { isSegmentationPanelDisabled } from './segmentationPanelGate';

jest.mock('@ohif/core', () => ({ __esModule: true, default: { utils: { studyMetadataManager: { get: () => undefined } } } }), { virtual: true });
jest.mock('@ohif/extension-seg3d-editor', () => ({ Enums: { VIEWPORT_PLUGIN: 'sonador3dseg' } }), { virtual: true });
jest.mock('@ohif/extension-viewerm3d', () => ({ isSTLDisplaySet: () => false }), { virtual: true });

const study = (StudyInstanceUID, modalities) => ({ StudyInstanceUID, series: modalities.map(Modality => ({ Modality })) });

function deps({ derived = [], stl = false } = {}) {
  return {
    getStudyMetadata: jest.fn(() => ({
      getDerivedDatasets: () => derived,
      getDisplaySets: () => [{ m3d: stl }],
    })),
    isSTLDisplaySet: displaySet => !!displaySet.m3d,
    onSegBadge: jest.fn(),
  };
}

describe('isSegmentationPanelDisabled', () => {
  it('offers the panel while the Segmentation Editor is the active viewport, whatever the study holds', () => {
    const editor = { plugin: 'sonador3dseg', StudyInstanceUID: 's', SeriesInstanceUID: 'ct' };
    expect(isSegmentationPanelDisabled([study('s', ['CT'])], editor, deps())).toBe(false);
    expect(isSegmentationPanelDisabled(undefined, editor, deps())).toBe(false);
  });

  it('hides the panel for a study with neither SEG nor STL series when the editor is closed', () => {
    const cornerstone = { plugin: 'cornerstone', StudyInstanceUID: 's', SeriesInstanceUID: 'ct' };
    expect(isSegmentationPanelDisabled([study('s', ['CT', 'MR'])], cornerstone, deps())).toBe(true);
    expect(isSegmentationPanelDisabled(undefined, cornerstone, deps())).toBe(true);
    expect(isSegmentationPanelDisabled([study('s', ['CT'])], undefined, deps())).toBe(true);
  });

  it('offers the panel for a SEG study and reports how many SEGs reference the active series', () => {
    const d = deps({ derived: [{}, {}] });
    const active = { plugin: 'cornerstone', StudyInstanceUID: 's', SeriesInstanceUID: 'ct' };
    expect(isSegmentationPanelDisabled([study('s', ['CT', 'SEG'])], active, d)).toBe(false);
    expect(d.onSegBadge).toHaveBeenCalledWith({ badgeNumber: 2, target: 'segmentation-panel' });
    // Without an active viewport the tab is offered and no badge is reported
    expect(isSegmentationPanelDisabled([study('s', ['SEG'])], undefined, deps())).toBe(false);
  });

  it('offers the panel for an STL model series but not for a GLB scene', () => {
    const active = { plugin: 'cornerstone', StudyInstanceUID: 's', SeriesInstanceUID: 'ct' };
    expect(isSegmentationPanelDisabled([study('s', ['CT', 'M3D'])], active, deps({ stl: true }))).toBe(false);
    expect(isSegmentationPanelDisabled([study('s', ['CT', 'M3D'])], active, deps({ stl: false }))).toBe(true);
  });
});
