// Segmentation Editor layout presets: every preset places all four views, and the views shown
// on first render match the preset's description.

import { webcrypto } from 'crypto';
import { Model } from 'flexlayout-react';

import {
  DEFAULT_SEG_EDITOR_LAYOUT,
  SEG_EDITOR_LAYOUTS,
  SEG_EDITOR_TABS,
  getInitiallyVisibleTabs,
  getSegEditorLayout,
  getSegEditorLayoutJson,
} from './segEditorLayouts';

// The enums reach @ohif/extension-vtk, and with it the viewer runtime; only the tab names are needed
jest.mock('@ohif/extension-vtk', () => ({
  Enums: { CORNERSTONE: { AXIAL: 'Axial', CORONAL: 'Coronal', SAGITTAL: 'Sagittal', C3D_3D: '3D' } },
}));

// flexlayout ids come from crypto.getRandomValues, which Node 18 exposes only as webcrypto
beforeAll(() => {
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
});

const tabNames = (layout) => {
  const names = [];
  const visit = (node) => {
    if (node.type === 'tab') {
      names.push(node.name);
    }
    (node.children || []).forEach(visit);
  };
  visit(layout);
  return names;
};

describe('SEG_EDITOR_LAYOUTS', () => {
  it.each(SEG_EDITOR_LAYOUTS.map(preset => [preset.id, preset]))(
    '%s places each of the four views exactly once', (id, preset) => {
      expect([...tabNames(preset.layout)].sort()).toEqual([...SEG_EDITOR_TABS].sort());
      expect(preset.title).toBeTruthy();
      expect(preset.icon).toMatch(/^layout-advanced-/);
    });

  it.each(SEG_EDITOR_LAYOUTS.map(preset => [preset.id]))('%s builds a flexlayout model', (id) => {
    const model = Model.fromJson(getSegEditorLayoutJson(id));
    const names = [];
    model.visitNodes(node => {
      if (node.getType() === 'tab') {
        names.push(node.getName());
      }
    });
    expect(names.sort()).toEqual([...SEG_EDITOR_TABS].sort());
  });

  it.each([
    ['mpr', ['Axial', 'Sagittal', 'Coronal']],
    ['fourUp', ['Axial', 'Coronal', 'Sagittal', '3D']],
    ['main3D', ['3D', 'Axial', 'Coronal', 'Sagittal']],
    ['primaryAxial', ['Axial', 'Sagittal', 'Coronal']],
    ['only3D', ['3D']],
    ['primary3D', ['3D', 'Axial', 'Coronal', 'Sagittal']],
  ])('%s initially shows %j', (id, expected) => {
    expect(getInitiallyVisibleTabs(getSegEditorLayoutJson(id))).toEqual(expected);
  });

  it('lays 3D Main out top to bottom and the others left to right', () => {
    expect(getSegEditorLayoutJson('main3D').global.rootOrientationVertical).toBe(true);
    expect(getSegEditorLayoutJson('primary3D').global.rootOrientationVertical).toBe(false);
  });

  it('falls back to the default preset for an unknown id', () => {
    expect(getSegEditorLayout('nope').id).toBe(DEFAULT_SEG_EDITOR_LAYOUT);
    expect(getSegEditorLayout(undefined).id).toBe(DEFAULT_SEG_EDITOR_LAYOUT);
  });

  it('returns a fresh JSON tree each time', () => {
    const a = getSegEditorLayoutJson('mpr');
    const b = getSegEditorLayoutJson('mpr');
    expect(a).toEqual(b);
    expect(a.layout).not.toBe(b.layout);
    expect(a.layout.children[0]).not.toBe(b.layout.children[0]);
  });
});
