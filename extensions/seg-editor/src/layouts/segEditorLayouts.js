// Segmentation Editor layout presets: the flexlayout-react models behind the toolbar's Layout
// widget. Each preset arranges the editor's four views (3D, Axial, Coronal, Sagittal) so that
// every view has a tab; views that share a tabset are reached by clicking their tab.
//
// The ids, titles and icons follow OHIF v3's advanced layout presets (its hanging protocols
// `mpr`, `fourUp`, `main3D`, `primaryAxial`, `only3D`, `primary3D`).

import { Enums as SegEnums } from '../enums';

const TAB_3D = SegEnums.SEGVIEWER_3D;
const TAB_AXIAL = SegEnums.SEGVIEWER_AXIAL;
const TAB_CORONAL = SegEnums.SEGVIEWER_CORONAL;
const TAB_SAGITTAL = SegEnums.SEGVIEWER_SAGITTAL;

export const SEG_EDITOR_TABS = [TAB_3D, TAB_AXIAL, TAB_CORONAL, TAB_SAGITTAL];

export const DEFAULT_SEG_EDITOR_LAYOUT = 'primary3D';


const tab = (name) => ({
  type: 'tab',
  name,
  component: name === TAB_3D ? 'placeholder' : 'seg3dview',
  enableClose: false,
  enableRename: false,
});

// A tabset showing `names[selected]` first
const tabset = (names, { weight = 100, selected = 0 } = {}) => ({
  type: 'tabset',
  weight,
  selected,
  children: names.map(tab),
});

// flexlayout alternates the orientation of nested rows: the root row lays its children out
// horizontally (vertically with `rootOrientationVertical`), its child rows the other way.
const row = (children, weight = 100) => ({ type: 'row', weight, children });


export const SEG_EDITOR_LAYOUTS = [
  {
    id: 'mpr',
    title: 'MPR',
    icon: 'layout-advanced-mpr',
    // Three columns; the 3D view shares the first column's tabset with Axial
    layout: row([
      tabset([TAB_AXIAL, TAB_3D], { weight: 34 }),
      tabset([TAB_SAGITTAL], { weight: 33 }),
      tabset([TAB_CORONAL], { weight: 33 }),
    ]),
  },
  {
    id: 'fourUp',
    title: '3D Four Up',
    icon: 'layout-advanced-3d-four-up',
    // Balanced 2 x 2: Axial | Sagittal over Coronal | 3D
    layout: row([
      row([tabset([TAB_AXIAL], { weight: 50 }), tabset([TAB_CORONAL], { weight: 50 })], 50),
      row([tabset([TAB_SAGITTAL], { weight: 50 }), tabset([TAB_3D], { weight: 50 })], 50),
    ]),
  },
  {
    id: 'main3D',
    title: '3D Main',
    icon: 'layout-advanced-3d-main',
    // 3D across the top row, the three planes across the bottom row
    rootOrientationVertical: true,
    layout: row([
      tabset([TAB_3D], { weight: 60 }),
      row([
        tabset([TAB_AXIAL], { weight: 34 }),
        tabset([TAB_CORONAL], { weight: 33 }),
        tabset([TAB_SAGITTAL], { weight: 33 }),
      ], 40),
    ]),
  },
  {
    id: 'primaryAxial',
    title: 'Axial Primary',
    icon: 'layout-advanced-axial-primary',
    // Axial in the first column (3D behind it), Sagittal over Coronal in the second
    layout: row([
      tabset([TAB_AXIAL, TAB_3D], { weight: 60 }),
      row([tabset([TAB_SAGITTAL], { weight: 50 }), tabset([TAB_CORONAL], { weight: 50 })], 40),
    ]),
  },
  {
    id: 'only3D',
    title: '3D Only',
    icon: 'layout-advanced-3d-only',
    // One tabset; 3D in front
    layout: row([tabset([TAB_3D, TAB_AXIAL, TAB_CORONAL, TAB_SAGITTAL])]),
  },
  {
    id: 'primary3D',
    title: '3D Primary',
    icon: 'layout-advanced-3d-primary',
    // The editor's default: 3D in the first column, the three planes stacked in the second
    layout: row([
      tabset([TAB_3D], { weight: 60 }),
      row([
        tabset([TAB_AXIAL], { weight: 34 }),
        tabset([TAB_CORONAL], { weight: 33 }),
        tabset([TAB_SAGITTAL], { weight: 33 }),
      ], 40),
    ]),
  },
];


export function getSegEditorLayout(id) {
  // The preset for `id`, or the default preset when `id` is unknown
  return SEG_EDITOR_LAYOUTS.find(preset => preset.id === id)
    || SEG_EDITOR_LAYOUTS.find(preset => preset.id === DEFAULT_SEG_EDITOR_LAYOUT);
}

export function getSegEditorLayoutJson(id) {
  // A fresh flexlayout model JSON for the preset (`Model.fromJson` input)
  const preset = getSegEditorLayout(id);
  return {
    global: { rootOrientationVertical: !!preset.rootOrientationVertical },
    borders: [],
    layout: JSON.parse(JSON.stringify(preset.layout)),
  };
}

export function getInitiallyVisibleTabs(layoutJson) {
  // The tab names shown when a model built from `layoutJson` first renders (the selected tab
  // of each tabset)
  const visible = [];
  const visit = (node) => {
    if (node.type === 'tabset') {
      const selected = node.children[node.selected || 0];
      if (selected) {
        visible.push(selected.name);
      }
    } else {
      (node.children || []).forEach(visit);
    }
  };
  visit(layoutJson.layout || layoutJson);
  return visible;
}
