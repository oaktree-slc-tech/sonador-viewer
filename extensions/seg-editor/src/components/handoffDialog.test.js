/**
 * @jest-environment jsdom
 */
// The handoff dialog (ohif-viewers#152): its title and opening per reason, the facts rows (the
// pending edits, the surface, what writing would do) and their omit rules, the consequence lines
// for the surface actually found, the footer (cancel, Repair, the destination pull-down or
// Synchronize's plain buttons) with its hover text and menu lines, the keyboard, and the answer
// it resolves. The strings come from the en-US locale, so a key the locale lacks fails here.

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import locale from '../../../../platform/i18n/src/locales/en-US/SegmentationEditor.json';

import {
  callHandoffDialog,
  editRow,
  HANDOFF_CHOICES,
  HandoffDialog,
  handoffActions,
  handoffBody,
  handoffFacts,
  handoffHints,
  handoffNotices,
  handoffTitle,
  surfaceSummary,
} from './handoffDialog';

jest.mock('@ohif/ui', () => {
  const React = require('react');
  return {
    SimpleDialogShell: ({ componentRef, headerTitle, children, onClose, rootClass }) => React.createElement(
      'div', { ref: componentRef, className: rootClass, 'data-title': headerTitle },
      React.createElement('button', { className: 'closeBtn', onClick: onClose }, 'x'),
      children,
    ),
  };
}, { virtual: true });

jest.mock('@ohif/ui-next', () => {
  const React = require('react');
  const passthrough = ({ children }) => React.createElement(React.Fragment, null, children);
  const MenuContext = React.createContext({ open: false, setOpen: () => {} });
  const Button = React.forwardRef(({ children, variant, ...props }, ref) => React.createElement('button', { ref, 'data-variant': variant, ...props }, children));
  Button.displayName = 'Button';
  return {
    Button,
    Icons: { ChevronDown: props => React.createElement('span', { ...props, 'data-icon': 'chevron-down' }) },
    Tooltip: passthrough,
    TooltipTrigger: passthrough,
    TooltipContent: ({ children }) => React.createElement('span', { hidden: true, 'data-tooltip': true }, children),
    TooltipProvider: passthrough,
    DropdownMenu: ({ open, onOpenChange, children }) => React.createElement(MenuContext.Provider, { value: { open, setOpen: onOpenChange } }, children),
    DropdownMenuTrigger: ({ children }) => {
      const { open, setOpen } = React.useContext(MenuContext);
      return React.cloneElement(children, { onClick: () => setOpen(!open), 'aria-expanded': open });
    },
    DropdownMenuContent: ({ children, ...props }) => {
      const { open } = React.useContext(MenuContext);
      return open ? React.createElement('div', { role: 'menu', 'data-cy': props['data-cy'] }, children) : null;
    },
    DropdownMenuItem: ({ children, disabled, onSelect, ...props }) => {
      // Radix closes the menu when an item is selected
      const { setOpen } = React.useContext(MenuContext);
      const select = () => {
        if (!disabled) {
          onSelect();
          setOpen(false);
        }
      };
      return React.createElement('button', { role: 'menuitem', disabled, onClick: select, 'data-cy': props['data-cy'] }, children);
    },
    DropdownMenuSeparator: () => React.createElement('hr'),
  };
}, { virtual: true });

global.IS_REACT_ACT_ENVIRONMENT = true;

// i18next as far as the dialog uses it: `count` picks _one / _other, placeholders interpolate
const t = (key, options = {}) => {
  const plural = options.count !== undefined ? `${key}_${Number(options.count) === 1 ? 'one' : 'other'}` : null;
  const text = (plural && locale[plural]) || locale[key];
  if (text === undefined) {
    throw new Error(`en-US SegmentationEditor lacks the key: ${key}`);
  }
  return text.replace(/{{(\w+)}}/g, (_m, name) => String(options[name]));
};

// The owner's case (2026-10-26): one Remove on "tibia" whose patch left 194 open edges; the
// write would clear 266 voxels in a 14 × 23 × 18 box
const removeEdit = { kind: 'remove', faces: 212, points: 140, holes: 1, openEdges: 194, depth: 2, status: 'surfaceOnly', reason: 'defects' };
const tibia = {
  segment: 'tibia', unsynchronized: 1, failed: 0, checked: true, isTarget: true, lengthUnit: 'mm',
  defects: { boundaryEdgeCount: 194, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: false },
  edits: [removeEdit],
};
const removes266 = { domain: { min: [10, 20, 30], max: [23, 42, 47] }, domainVoxels: 5796, remove: 266, add: 0, dropped: 0, farField: 0 };
const smoothEdit = { kind: 'smooth', points: 340, status: 'surfaceOnly', reason: 'unsynchronized' };
const clean2 = {
  ...tibia, unsynchronized: 2, defects: { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: true },
  edits: [{ ...removeEdit, openEdges: 0, status: 'refused' }, smoothEdit],
};
const both = { domain: { min: [0, 0, 0], max: [21, 18, 13] }, domainVoxels: 5852, remove: 120, add: 40, dropped: 12, farField: 0 };
const unchecked = { ...tibia, checked: false, defects: null };
const nonManifold = { ...tibia, defects: { boundaryEdgeCount: 0, nonManifoldEdgeCount: 3, inconsistentEdgeCount: 1, closed: false } };
const mixed = { ...tibia, defects: { boundaryEdgeCount: 2, nonManifoldEdgeCount: 1, inconsistentEdgeCount: 0, closed: false } };
const femur = { segmentIndex: 2, label: 'femur' };
const nothing = { ...removes266, remove: 0, add: 0, domain: null };
const failed = { message: 'worker lost' };
// Findings as an older canvas would send them: a count, no list
const counted = { ...tibia, edits: undefined };

describe('title and opening', () => {
  it('asks the question the buttons answer, per reason', () => {
    expect(handoffTitle(t, 'labelmap')).toBe('Write 3D edits to the 2D slices before switching toolbox?');
    expect(handoffTitle(t, 'target')).toBe('Write 3D edits to the 2D slices before switching segment?');
    expect(handoffTitle(t, 'import')).toBe('Write 3D edits to the 2D slices before importing?');
    expect(handoffTitle(t, 'exit')).toBe('Write 3D edits to the 2D slices before closing the editor?');
    expect(handoffTitle(t, 'sync')).toBe('Write 3D edits to the 2D slices?');
    expect(handoffTitle(t, 'other')).toBe('Write 3D edits to the 2D slices?');
  });

  it('says what the user did, that the slices lack the edits, that leaving writes or drops them, and the caveat of a damaged surface', () => {
    expect(handoffBody(t, { reason: 'labelmap', findings: tibia, proposal: removes266 })).toBe(
      'You chose Labelmap Tools, which edit the 2D slices. The 3D surface of "tibia" has 1 edit the slices do not have. '
      + 'Switching writes it to the slices or drops it; the surface has open edges, so the written slices can differ from the canvas near it.',
    );
    expect(handoffBody(t, { reason: 'target', destination: femur, findings: clean2, proposal: both })).toBe(
      'You selected "femur". The 3D surface of "tibia" has 2 edits the 2D slices do not have. Switching writes them to the slices or drops them.',
    );
    expect(handoffBody(t, { reason: 'target', destination: null, findings: clean2, proposal: both })).toMatch(/^You selected another segment\. /);
    expect(handoffBody(t, { reason: 'import', findings: mixed, proposal: removes266 })).toBe(
      'You started an import, which replaces the current segmentation. The 3D surface of "tibia" has 1 edit the 2D slices do not have. '
      + 'Importing writes it to the slices first or drops it; the surface has open and non-manifold edges, so the written slices can differ from the canvas near it.',
    );
    expect(handoffBody(t, { reason: 'exit', findings: unchecked, proposal: removes266 })).toBe(
      'You are closing the editor, which keeps only the 2D slices. The 3D surface of "tibia" has 1 edit the slices do not have. '
      + 'Closing writes it to the slices or drops it; the surface check has not finished, so the match with the canvas is not verified.',
    );
    expect(handoffBody(t, { reason: 'sync', findings: clean2, proposal: both })).toBe(
      'The 3D surface of "tibia" has 2 edits the 2D slices do not have. Writing applies them to the slices; you stay in 3D Tools.',
    );
    expect(handoffBody(t, { reason: 'sync', findings: { ...nonManifold, unsynchronized: 2 }, proposal: both })).toMatch(
      /Writing applies them to the slices; the surface has non-manifold and inverted edges, so the written slices can differ from the canvas near them\.$/,
    );
  });
});

describe('facts', () => {
  const ids = rows => rows.map(row => row.id);

  it('lists the pending edits with why each is not written, the surface, then under a caption what writing would do', () => {
    expect(handoffFacts(t, { findings: tibia, proposal: removes266, failure: null })).toEqual([
      { id: 'edits', caption: 'Pending 3D edits' },
      { id: 'edit-0', label: 'Remove', value: '212 faces removed · 1 hole closed · 194 edges left open · not written: surface has open edges' },
      { id: 'surface', label: 'Surface', value: '194 open edges' },
      { id: 'writes', caption: 'Writing to the slices would' },
      { id: 'removes', label: 'Remove', value: '266 voxels' },
      { id: 'depth', label: 'Removal depth', value: '2 mm' },
      { id: 'region', label: 'Within', value: '14 × 23 × 18 voxels' },
    ]);
    expect(handoffFacts(t, { findings: clean2, proposal: both, failure: null })).toEqual([
      { id: 'edits', caption: 'Pending 3D edits' },
      { id: 'edit-0', label: 'Remove', value: '212 faces removed · 1 hole closed · not written: write refused' },
      { id: 'edit-1', label: 'Smooth', value: '340 points smoothed · not written: an earlier edit is not written' },
      { id: 'surface', label: 'Surface', value: 'Closed' },
      { id: 'writes', caption: 'Writing to the slices would' },
      { id: 'removes', label: 'Remove', value: '120 voxels' },
      { id: 'adds', label: 'Add', value: '40 voxels' },
      { id: 'depth', label: 'Removal depth', value: '2 mm' },
      { id: 'skips', label: 'Skip', value: '12 voxels now in another segment' },
      { id: 'region', label: 'Within', value: '22 × 19 × 14 voxels' },
    ]);
  });

  it('words each edit kind and reason, caps the list at four, and falls back to a count without a list', () => {
    expect(editRow(t, { kind: 'repair', holes: 3, status: 'failed' }, 0).value).toBe('3 open rims closed · not written: write failed');
    expect(editRow(t, { kind: 'sync', covered: 2, status: 'failed' }, 0)).toMatchObject({ label: 'Write', value: '2 edits written together · not written: write failed' });
    expect(editRow(t, { kind: 'remove', faces: 1, holes: 0, openEdges: 1, status: 'surfaceOnly', reason: 'defects' }, 0).value)
      .toBe('1 face removed · 1 edge left open · not written: surface has open edges');
    expect(editRow(t, { kind: 'remove', faces: 4, status: 'surfaceOnly', reason: 'defects', after: { boundaryEdgeCount: 0 } }, 0).value).toMatch(/surface has damaged edges$/);
    expect(editRow(t, { kind: 'smooth', points: 1, status: 'surfaceOnly', reason: 'unchecked' }, 0).value).toBe('1 point smoothed · not written: surface not checked');
    expect(editRow(t, { kind: 'repair', holes: 1, status: 'surfaceOnly', reason: 'repair' }, 0).value).toMatch(/a repair changes the 3D surface only$/);

    const many = { ...clean2, unsynchronized: 6, edits: [removeEdit, smoothEdit, removeEdit, smoothEdit, removeEdit, smoothEdit] };
    const rows = handoffFacts(t, { findings: many, proposal: both, failure: null });
    expect(ids(rows).slice(0, 7)).toEqual(['edits', 'edit-0', 'edit-1', 'edit-2', 'edit-3', 'more', 'surface']);
    expect(rows[5]).toEqual({ id: 'more', label: '', value: '+2 more' });

    expect(handoffFacts(t, { findings: counted, proposal: removes266, failure: null }).slice(0, 2)).toEqual([
      { id: 'edits', label: 'Unsynced edits', value: '1' },
      { id: 'surface', label: 'Surface', value: '194 open edges' },
    ]);
    expect(handoffFacts(t, { findings: { ...counted, unsynchronized: 2, failed: 1 }, proposal: null, failure: null })[0].value).toBe('2 (1 failed to write)');
  });

  it('says "No voxels" when nothing changes, leaves out the depth without a removal, and drops the writing group without a proposal or after a failure', () => {
    expect(handoffFacts(t, { findings: tibia, proposal: nothing, failure: null }).slice(3)).toEqual([
      { id: 'writes', caption: 'Writing to the slices would' },
      { id: 'change', label: 'Change', value: 'No voxels' },
    ]);
    expect(ids(handoffFacts(t, { findings: { ...clean2, edits: [smoothEdit] }, proposal: both, failure: null }))).not.toContain('depth');
    expect(ids(handoffFacts(t, { findings: tibia, proposal: null, failure: null }))).toEqual(['edits', 'edit-0', 'surface']);
    expect(ids(handoffFacts(t, { findings: clean2, proposal: both, failure: failed }))).toEqual(['edits', 'edit-0', 'edit-1', 'surface']);
    expect(surfaceSummary(t, unchecked)).toBe('Check not finished');
    expect(surfaceSummary(t, nonManifold)).toBe('3 non-manifold edges, 1 inverted edge');
  });
});

describe('consequence lines', () => {
  const texts = args => handoffNotices(t, args).map(notice => [notice.kind, notice.tone, notice.text]);

  it('says what the slices will show, the one caveat of the defects found, and the bound', () => {
    expect(texts({ findings: tibia, proposal: removes266, failure: null })).toEqual([
      ['consequence', 'warning', 'The 2D slices will show your cut: 266 voxels removed in "tibia". Where the holes could not be closed, inside and outside cannot be told apart, so near those 194 open edges some voxels can be cleared or kept differently than the canvas shows.'],
      ['bound', 'muted', 'Nothing outside the 14 × 23 × 18 voxel region changes. The edges stay open.'],
    ]);
    expect(texts({ findings: clean2, proposal: both, failure: null })).toEqual([
      ['consequence', 'plain', 'The 2D slices will show exactly what the canvas shows: 120 voxels removed and 40 voxels added in "tibia". The surface is closed, so every change comes from your edits.'],
      ['bound', 'muted', 'Nothing outside the 22 × 19 × 14 voxel region changes.'],
    ]);
    expect(texts({ findings: nonManifold, proposal: removes266, failure: null })).toEqual([
      ['consequence', 'warning', 'The 2D slices will show your edits: 266 voxels removed in "tibia". Along the 3 non-manifold edges and 1 inverted edge, which Repair cannot fix, inside and outside cannot be told apart, so voxels beside those edges can be cleared or kept differently than the canvas shows.'],
      ['bound', 'muted', 'Nothing outside the 14 × 23 × 18 voxel region changes. The damaged edges stay.'],
    ]);
    expect(texts({ findings: mixed, proposal: { ...removes266, add: 1 }, failure: null })[0][2]).toBe(
      'The 2D slices will show your edits: 266 voxels removed and 1 voxel added in "tibia". Near the 2 open edges and along the 1 non-manifold edge, voxels can be cleared or kept differently than the canvas shows; Repair closes the open edges only.',
    );
    expect(texts({ findings: unchecked, proposal: removes266, failure: null })).toEqual([
      ['consequence', 'warning', 'The 2D slices will show your edits: 266 voxels removed in "tibia". The surface check has not finished, so it is not verified that the slices will match the canvas near the edits.'],
      ['bound', 'muted', 'Nothing outside the 14 × 23 × 18 voxel region changes.'],
    ]);
    expect(texts({ findings: clean2, proposal: { ...both, domain: null }, failure: null })[1][2]).toBe('Nothing outside the edited region changes.');
  });

  it('says when nothing changes, leads with the retry of a failed write, and replaces everything after a failure', () => {
    expect(texts({ findings: tibia, proposal: nothing, failure: null })).toEqual([
      ['consequence', 'plain', 'This edit changes no voxel in the 2D slices of "tibia"; writing leaves the slices as they are.'],
    ]);
    expect(texts({ findings: { ...clean2, failed: 1 }, proposal: both, failure: null }).map(line => line[0])).toEqual(['retry', 'consequence', 'bound']);
    expect(texts({ findings: { ...clean2, failed: 1 }, proposal: both, failure: null })[0]).toEqual(['retry', 'muted', 'The last write failed; writing tries again.']);

    expect(texts({ findings: tibia, proposal: null, failure: null })).toEqual([[
      'unavailable', 'warning', 'The write could not be previewed, so the voxel counts are unknown and writing is not available. Stay in 3D Tools, or discard the edit.',
    ]]);
    expect(texts({ findings: { ...clean2, failed: 1 }, proposal: null, failure: failed })).toEqual([[
      'failure', 'destructive', 'Write failed: worker lost. Nothing in the 2D slices changed; the 2 edits are still on the surface.',
    ]]);
    expect(texts({ findings: tibia, proposal: null, failure: {} })[0][2]).toBe('Write failed. Nothing in the 2D slices changed; the edit is still on the surface.');
  });
});

describe('actions', () => {
  it('for a damaged surface: Stay is the default, Repair carries the open-edge count, the pull-down holds Write and Discard with their lines', () => {
    const actions = handoffActions(t, { reason: 'labelmap', findings: tibia, proposal: removes266, failure: null });
    expect(actions.defaultId).toBe('continue');
    expect(actions.cancel).toEqual({
      id: 'continue', label: 'Stay in 3D Tools', variant: 'default', isDefault: true,
      tooltip: 'Returns to 3D Tools. Nothing is written and the toolbox does not switch.',
    });
    expect(actions.repair).toEqual({
      id: 'repair', label: 'Repair 194 open edges...', variant: 'secondary', enabled: true, reason: undefined,
      tooltip: 'Closes the 194 open edges across the whole surface and shows the result to apply or cancel. You stay in 3D Tools; switch toolbox again afterwards.',
    });
    expect(actions.discard).toBeNull();
    expect(actions.write).toBeNull();
    expect(actions.leave).toEqual({
      label: 'Switch toolbox', variant: 'secondary', isDefault: false,
      tooltip: 'Two ways to switch toolbox: write the edit to the slices, or discard it.',
      items: [
        {
          id: 'proceed', title: 'Write edit to slices', enabled: true, destructive: false, isDefault: false,
          description: '266 voxels removed in "tibia"; near the 194 open edges the result can differ from the canvas. Then opens Labelmap Tools.',
        },
        {
          id: 'discard', title: 'Discard edit', enabled: true, destructive: true, isDefault: false,
          description: 'Drops the 3D edit to "tibia"; the 2D slices stay as they are. Then opens Labelmap Tools.',
        },
      ],
    });
    expect(handoffHints(actions)).toEqual([]);
  });

  it('for a clean, checked surface with a proposal: the pull-down is the default and Return writes; no Repair', () => {
    const actions = handoffActions(t, { reason: 'target', destination: femur, findings: clean2, proposal: both, failure: null });
    expect(actions.defaultId).toBe('proceed');
    expect(actions.cancel).toMatchObject({ variant: 'outline', isDefault: false, tooltip: 'Returns to 3D Tools. Nothing is written and the 3D tools stay on "tibia".' });
    expect(handoffActions(t, { reason: 'target', findings: { ...clean2, isTarget: false }, proposal: both, failure: null }).cancel.tooltip)
      .toBe('Returns to 3D Tools. Nothing is written and the 3D tools stay where they are.');
    expect(actions.repair).toBeNull();
    expect(actions.leave).toMatchObject({ label: 'Switch segment', variant: 'default', isDefault: true, tooltip: 'Two ways to switch segment: write the edits to the slices, or discard them.' });
    expect(actions.leave.items[0]).toMatchObject({
      isDefault: true, title: 'Write edits to slices',
      description: '120 voxels removed and 40 voxels added in "tibia", exactly as the canvas shows. Then switches to "femur".',
    });
    expect(actions.leave.items[1].description).toBe('Drops the 2 3D edits to "tibia"; the 2D slices stay as they are. Then switches to "femur".');

    expect(handoffActions(t, { reason: 'target', findings: clean2, proposal: both, failure: null }).leave.items[0].description).toMatch(/Then switches to the selected segment\.$/);
    const imported = handoffActions(t, { reason: 'import', findings: clean2, proposal: both, failure: null });
    expect(imported.leave).toMatchObject({ label: 'Import', tooltip: 'Two ways to import: write the edits to the slices, or discard them.' });
    expect(imported.leave.items[0].description).toMatch(/Then starts the import\.$/);
    expect(imported.cancel.tooltip).toBe('Returns to 3D Tools. Nothing is written and the import is cancelled.');
    const exit = handoffActions(t, { reason: 'exit', findings: clean2, proposal: both, failure: null });
    expect(exit.leave).toMatchObject({ label: 'Close editor', tooltip: 'Two ways to close the editor: write the edits to the slices, or discard them.' });
    expect(exit.leave.items[1].description).toMatch(/Then closes the editor\.$/);
    expect(exit.cancel.tooltip).toBe('Returns to 3D Tools. Nothing is written and the editor stays open.');
  });

  it('describes the write per surface state, and disables it with the reason without a proposal or after a failure', () => {
    const write = (findings, proposal, failure = null) => handoffActions(t, { reason: 'labelmap', findings, proposal, failure }).leave.items[0];
    expect(write(nonManifold, removes266).description).toBe('266 voxels removed in "tibia"; beside the damaged edges the result can differ from the canvas. Then opens Labelmap Tools.');
    expect(write(mixed, removes266).description).toBe('266 voxels removed in "tibia"; beside the damaged edges the result can differ from the canvas. Then opens Labelmap Tools.');
    expect(write(unchecked, removes266).description).toBe('266 voxels removed in "tibia"; surface not checked, match with the canvas not verified. Then opens Labelmap Tools.');
    expect(write(clean2, nothing).description).toBe('Changes no voxels. Then opens Labelmap Tools.');
    expect(write({ ...clean2, failed: 1 }, both).description).toBe('Tries the write again: 120 voxels removed and 40 voxels added in "tibia". Then opens Labelmap Tools.');
    expect(write(tibia, null)).toMatchObject({ enabled: false, description: 'Not available: the write could not be previewed.' });
    expect(write(tibia, null, failed)).toMatchObject({ enabled: false, description: 'Not available: the last write failed.' });
    // The default never falls on a disabled write
    expect(handoffActions(t, { reason: 'labelmap', findings: clean2, proposal: null, failure: null }).defaultId).toBe('continue');
  });

  it('shows Repair only when there are open edges to close and no failure; disabled with a hint off the active segment', () => {
    const repair = (findings, failure = null) => handoffActions(t, { reason: 'exit', findings, proposal: removes266, failure }).repair;
    expect(repair(clean2)).toBeNull();
    expect(repair(nonManifold)).toBeNull();
    expect(repair(unchecked)).toBeNull();
    expect(repair(tibia, failed)).toBeNull();
    expect(repair(mixed)).toMatchObject({ label: 'Repair 2 open edges...', enabled: true });
    expect(repair({ ...mixed, defects: { ...mixed.defects, boundaryEdgeCount: 1 } }).label).toBe('Repair 1 open edge...');
    expect(repair(tibia).tooltip).toMatch(/You stay in 3D Tools; press Exit again afterwards\.$/);
    const elsewhere = handoffActions(t, { reason: 'exit', findings: { ...tibia, isTarget: false }, proposal: removes266, failure: null });
    expect(elsewhere.repair).toMatchObject({ enabled: false, reason: 'Repair works on the active segment only. Stay in 3D Tools and select "tibia" first.' });
    expect(handoffHints(elsewhere)).toEqual(['Repair works on the active segment only. Stay in 3D Tools and select "tibia" first.']);
  });

  it('gives Synchronize plain buttons: Cancel and Discard on the left, Repair and Write to slices on the right', () => {
    const damaged = handoffActions(t, { reason: 'sync', findings: tibia, proposal: removes266, failure: null });
    expect(damaged.cancel).toMatchObject({ label: 'Cancel', variant: 'default', isDefault: true, tooltip: 'Closes this dialog. Nothing is written.' });
    expect(damaged.discard).toEqual({
      id: 'discard', label: 'Discard edit', variant: 'destructive', enabled: true,
      tooltip: 'Drops the 3D edit to "tibia"; the 2D slices stay as they are. Redo in 3D Tools brings it back.',
    });
    expect(damaged.repair.tooltip).toMatch(/You stay in 3D Tools; if no defect is left, Apply also writes it to the slices\.$/);
    expect(damaged.write).toEqual({
      id: 'proceed', label: 'Write to slices', variant: 'secondary', enabled: true, hidden: false, isDefault: false, reason: undefined,
      tooltip: '266 voxels removed in "tibia"; near the 194 open edges the result can differ from the canvas. You stay in 3D Tools.',
    });
    expect(damaged.leave).toBeNull();

    const clean = handoffActions(t, { reason: 'sync', findings: clean2, proposal: both, failure: null });
    expect(clean.write).toMatchObject({ variant: 'default', isDefault: true, tooltip: '120 voxels removed and 40 voxels added in "tibia", exactly as the canvas shows. You stay in 3D Tools.' });
    expect(clean.discard.tooltip).toBe('Drops the 2 3D edits to "tibia"; the 2D slices stay as they are. Redo in 3D Tools brings them back.');
    expect(clean.cancel.variant).toBe('outline');

    const noProposal = handoffActions(t, { reason: 'sync', findings: clean2, proposal: null, failure: null });
    expect(noProposal.write).toMatchObject({ enabled: false, hidden: false, reason: 'Not available: the write could not be previewed.' });
    expect(handoffHints(noProposal)).toEqual(['Not available: the write could not be previewed.']);
    const afterFailure = handoffActions(t, { reason: 'sync', findings: tibia, proposal: null, failure: failed });
    expect(afterFailure.write.hidden).toBe(true);
    expect(afterFailure.repair).toBeNull();
    expect(handoffHints(afterFailure)).toEqual([]);
  });
});

describe('HandoffDialog', () => {
  const mounted = [];
  const render = props => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(React.createElement(HandoffDialog, props)));
    mounted.push(() => { act(() => root.unmount()); container.remove(); });
    return container;
  };
  afterEach(() => {
    while (mounted.length) {
      mounted.pop()();
    }
  });
  const props = (reason, findings, proposal, failure = null, destination = null) => ({
    headerTitle: handoffTitle(t, reason),
    body: handoffBody(t, { reason, destination, findings, proposal, failure }),
    facts: handoffFacts(t, { findings, proposal, failure }),
    notices: handoffNotices(t, { findings, proposal, failure }),
    actions: handoffActions(t, { reason, destination, findings, proposal, failure }),
    onChoose: jest.fn(),
  });
  const key = (target, k) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
  const click = element => act(() => { element.click(); });
  const cy = (container, id) => container.querySelector(`[data-cy="seg-editor-handoff-${id}"]`);

  it('renders the opening, the rows with their captions, the consequence and bound lines and the footer for the owner\'s case', () => {
    const p = props('labelmap', tibia, removes266);
    const container = render(p);
    expect(container.querySelector('[data-cy="seg-editor-handoff"] p').textContent).toMatch(/^You chose Labelmap Tools, which edit the 2D slices\./);
    expect(Array.from(container.querySelectorAll('dt')).map(node => node.textContent)).toEqual(['Remove', 'Surface', 'Remove', 'Removal depth', 'Within']);
    expect(cy(container, 'edits').textContent).toBe('Pending 3D edits');
    expect(cy(container, 'edit-0').textContent).toMatch(/^212 faces removed/);
    expect(cy(container, 'writes').textContent).toBe('Writing to the slices would');
    expect(cy(container, 'consequence').textContent).toMatch(/^The 2D slices will show your cut: 266 voxels removed/);
    expect(cy(container, 'bound').textContent).toBe('Nothing outside the 14 × 23 × 18 voxel region changes. The edges stay open.');
    const footer = Array.from(container.querySelectorAll('.footer button')).map(button => button.textContent);
    expect(footer).toEqual(['Stay in 3D Tools', 'Repair 194 open edges...', 'Switch toolbox']);
    expect(container.querySelector('[role="menu"]')).toBeNull();
    // The cancel is the default, and has focus
    expect(document.activeElement).toBe(cy(container, 'continue'));
    expect(cy(container, 'continue').getAttribute('data-default')).toBe('true');
  });

  it('answers the footer buttons and the menu items, ignores Escape and Return while the menu is open', () => {
    const p = props('labelmap', tibia, removes266);
    const container = render(p);
    click(cy(container, 'leave'));
    const menu = container.querySelector('[role="menu"]');
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual([
      'Write edit to slices266 voxels removed in "tibia"; near the 194 open edges the result can differ from the canvas. Then opens Labelmap Tools.',
      'Discard editDrops the 3D edit to "tibia"; the 2D slices stay as they are. Then opens Labelmap Tools.',
    ]);
    key(document.body, 'Escape');
    key(document.body, 'Enter');
    expect(p.onChoose).not.toHaveBeenCalled();
    click(cy(container, 'discard'));
    expect(p.onChoose).toHaveBeenCalledWith('discard');

    click(cy(container, 'leave'));
    click(cy(container, 'proceed'));
    expect(p.onChoose).toHaveBeenLastCalledWith('proceed');
    click(cy(container, 'repair'));
    expect(p.onChoose).toHaveBeenLastCalledWith('repair');
    click(container.querySelector('.closeBtn'));
    expect(p.onChoose).toHaveBeenLastCalledWith('continue');
  });

  it('Escape stays; Return performs the default: Stay for a damaged surface, the write for a clean one', () => {
    const damaged = props('exit', tibia, removes266);
    const one = render(damaged);
    key(document.body, 'Escape');
    expect(damaged.onChoose).toHaveBeenLastCalledWith('continue');
    key(one.querySelector('[data-cy="seg-editor-handoff"]'), 'Enter');
    expect(damaged.onChoose).toHaveBeenLastCalledWith('continue');
    expect(damaged.onChoose).toHaveBeenCalledTimes(2);
    mounted.pop()();

    const clean = props('target', clean2, both, null, femur);
    const two = render(clean);
    // Return writes without opening the menu; the content holds focus so the first Tab lands on Stay
    expect(document.activeElement).toBe(two.querySelector('[data-cy="seg-editor-handoff"]'));
    expect(cy(two, 'leave').getAttribute('data-default')).toBe('true');
    key(document.activeElement, 'Enter');
    expect(clean.onChoose).toHaveBeenLastCalledWith('proceed');
    // Return on a focused button is left to that button
    clean.onChoose.mockClear();
    cy(two, 'continue').focus();
    key(cy(two, 'continue'), 'Enter');
    expect(clean.onChoose).not.toHaveBeenCalled();
  });

  it('after a failure: no Repair, the write item is disabled with its reason, Discard still leaves', () => {
    const p = props('labelmap', tibia, null, failed);
    const container = render(p);
    expect(Array.from(container.querySelectorAll('.footer button')).map(button => button.textContent)).toEqual(['Stay in 3D Tools', 'Switch toolbox']);
    expect(cy(container, 'failure').textContent).toBe('Write failed: worker lost. Nothing in the 2D slices changed; the edit is still on the surface.');
    click(cy(container, 'leave'));
    expect(cy(container, 'proceed').disabled).toBe(true);
    expect(cy(container, 'proceed').textContent).toMatch(/Not available: the last write failed\.$/);
    click(cy(container, 'proceed'));
    expect(p.onChoose).not.toHaveBeenCalled();
    click(cy(container, 'discard'));
    expect(p.onChoose).toHaveBeenCalledWith('discard');
  });

  it('gives Synchronize its plain buttons, with the hint for a write that is not available', () => {
    const container = render(props('sync', clean2, null));
    expect(Array.from(container.querySelectorAll('.footer button')).map(button => [button.textContent, button.disabled])).toEqual([
      ['Cancel', false], ['Discard edits', false], ['Write to slices', true],
    ]);
    expect(cy(container, 'hints').textContent).toBe('Not available: the write could not be previewed.');
    expect(cy(container, 'leave')).toBeNull();
  });
});

describe('callHandoffDialog', () => {
  function service() {
    const uiDialogService = { show: jest.fn(), dismiss: jest.fn() };
    const props = () => uiDialogService.show.mock.calls[0][0].contentProps;
    return { uiDialogService, props };
  }

  it('shows the decision with its parts and resolves the chosen way forward once', async () => {
    const { uiDialogService, props } = service();
    const answer = callHandoffDialog({ uiDialogService, t, reason: 'target', destination: femur, findings: clean2, proposal: both });

    expect(uiDialogService.show).toHaveBeenCalledWith(expect.objectContaining({ id: 'seg-editor-3d-handoff', title: 'Write 3D edits to the 2D slices before switching segment?' }));
    expect(props().body).toMatch(/^You selected "femur"\./);
    expect(props().facts.map(row => row.id)).toEqual(['edits', 'edit-0', 'edit-1', 'surface', 'writes', 'removes', 'adds', 'depth', 'skips', 'region']);
    expect(props().notices.map(notice => notice.kind)).toEqual(['consequence', 'bound']);
    expect(props().actions.leave.items.map(item => item.id)).toEqual(['proceed', 'discard']);
    expect(props().rootClass).toContain('sonadorSegEditorHandoff');
    props().onChoose(HANDOFF_CHOICES.proceed);
    props().onChoose(HANDOFF_CHOICES.discard);

    expect(await answer).toBe('proceed');
    expect(uiDialogService.dismiss).toHaveBeenCalledTimes(1);
  });

  it('continues editing on anything that is not a choice (the close control)', async () => {
    const { uiDialogService, props } = service();
    const answer = callHandoffDialog({ uiDialogService, t, reason: 'sync', findings: clean2, proposal: both });
    expect(uiDialogService.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Write 3D edits to the 2D slices?' }));
    props().onChoose(undefined);
    expect(await answer).toBe('continue');
  });
});
