// The handoff dialog of the 3D tools (ohif-viewers#152): shown when a segment's 3D surface has
// edits the 2D slices have not received and the user asks to synchronize, or to leave 3D editing
// (the Labelmap palette, another segment, an import, the editor's exit).
//
// Anatomy, after the HIG sheet pattern with a pull-down button (design reviews of 2026-10-24 and
// 2026-10-26, the later ones after the owner found the rebuilt sheet short on context): the title
// asks the real question ("Write 3D edits to the 2D slices before switching toolbox?"); the
// opening says what the user just did, that the slices do not have these edits, that leaving
// writes or drops them, and, for a damaged surface, that the written slices can differ from the
// canvas; a facts block lists the pending edits (what was done, and why each was not written),
// the surface, and, under a caption, what writing would do (Remove, Add, Removal depth, Skip,
// Within; rows that would read zero left out); the consequence lines say what the 2D slices will
// show and the one caveat the defects found carry, then the bound as a muted line; a muted line
// explains a button that is shown but not available. The footer: on the left the cancel ("Stay
// in 3D Tools", or "Cancel" for Synchronize); on the right Repair, labelled with the open-edge
// count and shown only when there are open edges to close, then the way out, a pull-down named
// after the destination ("Switch toolbox", "Switch segment", "Import", "Close editor") whose
// menu holds the two ways of leaving, each with a line saying what it does: write the edits to
// the slices, or discard them (destructive, behind a separator). Synchronize has no destination,
// so it gets plain buttons: Cancel and Discard on the left, Repair and Write to slices on the
// right. Return performs the write only for a clean, checked surface with a proposal; otherwise
// Return and Escape both stay. Nothing in the dialog is set below 13px.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { SimpleDialogShell } from '@ohif/ui';
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Icons,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@ohif/ui-next';

import { HANDOFF_CHOICES, HANDOFF_REASONS } from '../threeDTools/handoff';

import { confirmDialogKeyAction } from './confirmDialog';


export { HANDOFF_CHOICES, HANDOFF_REASONS };

const TITLES = {
  [HANDOFF_REASONS.sync]: 'Write 3D edits to the 2D slices?',
  [HANDOFF_REASONS.labelmap]: 'Write 3D edits to the 2D slices before switching toolbox?',
  [HANDOFF_REASONS.target]: 'Write 3D edits to the 2D slices before switching segment?',
  [HANDOFF_REASONS.import]: 'Write 3D edits to the 2D slices before importing?',
  [HANDOFF_REASONS.exit]: 'Write 3D edits to the 2D slices before closing the editor?',
};

// At most this many pending edits are listed; the rest are counted
const EDIT_ROWS = 4;

const _number = value => {
  try {
    return Number(value || 0).toLocaleString();
  } catch (error) {
    return String(value || 0);
  }
};

const _reason = reason => (TITLES[reason] ? reason : HANDOFF_REASONS.sync);

/** The title for the reason the dialog opened: the question the buttons answer. */
export function handoffTitle(t, reason) {
  return t(TITLES[_reason(reason)]);
}

// The surface as the dialog reasons about it
function _state(findings, proposal, failure) {
  const checked = !!findings.checked;
  const defects = findings.defects || {};
  const damaged = checked && defects.closed === false;
  const open = damaged ? defects.boundaryEdgeCount || 0 : 0;
  const nonManifold = damaged ? defects.nonManifoldEdgeCount || 0 : 0;
  const inverted = damaged ? defects.inconsistentEdgeCount || 0 : 0;
  const canSync = !!proposal && !failure;
  return {
    checked,
    damaged,
    clean: checked && !damaged,
    open,
    bad: nonManifold > 0 || inverted > 0,
    nonManifold,
    inverted,
    canSync,
    // Return performs the write only for a clean, checked surface with a proposal
    defaultId: checked && !damaged && canSync ? HANDOFF_CHOICES.proceed : HANDOFF_CHOICES.continue,
  };
}

// "a and b" / "a, b and c"
function _list(t, parts) {
  if (parts.length === 3) {
    return t('{{a}}, {{b}} and {{c}}', { a: parts[0], b: parts[1], c: parts[2] });
  }
  return parts.length === 2 ? t('{{a}} and {{b}}', { a: parts[0], b: parts[1] }) : parts[0] || '';
}

// The defect kinds found, without counts: "open and non-manifold edges" for the opening
function _defectKinds(t, state) {
  const parts = [];
  if (state.open > 0) {
    parts.push(t('open'));
  }
  if (state.nonManifold > 0) {
    parts.push(t('non-manifold'));
  }
  if (state.inverted > 0) {
    parts.push(t('inverted'));
  }
  return t('{{kinds}} edges', { kinds: _list(t, parts) });
}

// "194 open edges"
const _open = (t, open) => t('{{count}} open edges', { count: open });

// "1 non-manifold edge and 3 inverted edges"
function _bad(t, state) {
  const parts = [];
  if (state.nonManifold > 0) {
    parts.push(t('{{count}} non-manifold edges', { count: state.nonManifold }));
  }
  if (state.inverted > 0) {
    parts.push(t('{{count}} inverted edges', { count: state.inverted }));
  }
  return _list(t, parts);
}

// "266 voxels removed and 40 voxels added", either half alone, or null when nothing changes
function _changes(t, proposal) {
  const removed = proposal.remove > 0 ? t('{{n}} voxels removed', { count: proposal.remove, n: _number(proposal.remove) }) : null;
  const added = proposal.add > 0 ? t('{{n}} voxels added', { count: proposal.add, n: _number(proposal.add) }) : null;
  return removed && added ? t('{{removed}} and {{added}}', { removed, added }) : removed || added;
}

// "the 14 × 23 × 18 voxel region", or the words for a region the proposal did not bound
function _region(t, proposal) {
  const { domain } = proposal;
  if (!domain) {
    return t('the edited region');
  }
  const size = domain.max.map((max, axis) => max - domain.min[axis] + 1);
  return t('the {{i}} × {{j}} × {{k}} voxel region', { i: size[0], j: size[1], k: size[2] });
}

/**
 * The opening: what the user just did, that the 2D slices do not have these 3D edits, that
 * leaving writes or drops them, and, for a damaged or unchecked surface, the caveat (three
 * sentences at most).
 *
 * @param {Function} t
 * @param {{ reason: string, destination?: { label: string }|null, findings: Object, proposal?: Object|null, failure?: Object|null }} params
 * @returns {string}
 */
export function handoffBody(t, { reason, destination = null, findings, proposal = null, failure = null }) {
  const state = _state(findings, proposal, failure);
  const count = findings.unsynchronized;
  const vars = { segment: findings.segment, count, destination: destination?.label };
  // The clause after the semicolon of the last sentence, when the surface is not known sound
  const caveat = !state.checked
    ? t('the surface check has not finished, so the match with the canvas is not verified')
    : state.damaged
      ? t('the surface has {{defect}}, so the written slices can differ from the canvas near them', { count, defect: _defectKinds(t, state) })
      : null;
  const leaving = (plain, withCaveat) => (caveat ? t(withCaveat, { ...vars, caveat }) : t(plain, vars));
  switch (_reason(reason)) {
    case HANDOFF_REASONS.labelmap:
      return `${t('You chose Labelmap Tools, which edit the 2D slices. The 3D surface of "{{segment}}" has {{count}} edits the slices do not have.', vars)} ${leaving(
        'Switching writes them to the slices or drops them.', 'Switching writes them to the slices or drops them; {{caveat}}.',
      )}`;
    case HANDOFF_REASONS.target:
      return `${destination
        ? t('You selected "{{destination}}". The 3D surface of "{{segment}}" has {{count}} edits the 2D slices do not have.', vars)
        : t('You selected another segment. The 3D surface of "{{segment}}" has {{count}} edits the 2D slices do not have.', vars)} ${leaving(
        'Switching writes them to the slices or drops them.', 'Switching writes them to the slices or drops them; {{caveat}}.',
      )}`;
    case HANDOFF_REASONS.import:
      return `${t('You started an import, which replaces the current segmentation. The 3D surface of "{{segment}}" has {{count}} edits the 2D slices do not have.', vars)} ${leaving(
        'Importing writes them to the slices first or drops them.', 'Importing writes them to the slices first or drops them; {{caveat}}.',
      )}`;
    case HANDOFF_REASONS.exit:
      return `${t('You are closing the editor, which keeps only the 2D slices. The 3D surface of "{{segment}}" has {{count}} edits the slices do not have.', vars)} ${leaving(
        'Closing writes them to the slices or drops them.', 'Closing writes them to the slices or drops them; {{caveat}}.',
      )}`;
    default:
      return `${t('The 3D surface of "{{segment}}" has {{count}} edits the 2D slices do not have.', vars)} ${leaving(
        'Writing applies them to the slices; you stay in 3D Tools.', 'Writing applies them to the slices; {{caveat}}.',
      )}`;
  }
}

/**
 * The surface's defects as a short list ("3 open edges, 1 non-manifold edge"), or the words for
 * a closed or unchecked surface.
 */
export function surfaceSummary(t, findings) {
  if (!findings.checked) {
    return t('Check not finished');
  }
  const { defects } = findings;
  if (!defects || defects.closed !== false) {
    return t('Closed');
  }
  const parts = [];
  if (defects.boundaryEdgeCount > 0) {
    parts.push(t('{{count}} open edges', { count: defects.boundaryEdgeCount }));
  }
  if (defects.nonManifoldEdgeCount > 0) {
    parts.push(t('{{count}} non-manifold edges', { count: defects.nonManifoldEdgeCount }));
  }
  if (defects.inconsistentEdgeCount > 0) {
    parts.push(t('{{count}} inverted edges', { count: defects.inconsistentEdgeCount }));
  }
  return parts.length ? parts.join(', ') : t('Open');
}

const EDIT_LABELS = { remove: 'Remove', smooth: 'Smooth', repair: 'Repair', sync: 'Write' };

// Why a pending edit was not written, as the end of its row
function _notWritten(t, edit) {
  if (edit.status === 'failed') {
    return t('write failed');
  }
  if (edit.status === 'refused') {
    return t('write refused');
  }
  switch (edit.reason) {
    case 'unsynchronized':
      return t('an earlier edit is not written');
    case 'unchecked':
      return t('surface not checked');
    case 'repair':
      return t('a repair changes the 3D surface only');
    default:
      return edit.openEdges > 0 || edit.after?.boundaryEdgeCount > 0 ? t('surface has open edges') : t('surface has damaged edges');
  }
}

/**
 * One pending edit as a row: what was done, then why the slices do not have it.
 *
 * @param {{ kind: string, faces?: number, points?: number, holes?: number, openEdges?: number,
 *   covered?: number, status?: string, reason?: string }} edit
 */
export function editRow(t, edit, index) {
  const parts = [];
  switch (edit.kind) {
    case 'smooth':
      parts.push(t('{{count}} points smoothed', { count: edit.points || 0 }));
      break;
    case 'repair':
      parts.push(t('{{count}} open rims closed', { count: edit.holes || 0 }));
      break;
    case 'sync':
      parts.push(t('{{count}} edits written together', { count: edit.covered || 0 }));
      break;
    default:
      parts.push(t('{{count}} faces removed', { count: edit.faces || edit.points || 0 }));
      if (edit.holes > 0) {
        parts.push(t('{{count}} holes closed', { count: edit.holes }));
      }
      break;
  }
  if (edit.openEdges > 0) {
    parts.push(t('{{count}} edges left open', { count: edit.openEdges }));
  }
  parts.push(t('not written: {{reason}}', { reason: _notWritten(t, edit) }));
  return { id: `edit-${index}`, label: t(EDIT_LABELS[edit.kind] || EDIT_LABELS.remove), value: parts.join(' · ') };
}

/**
 * The facts block: the pending edits (or their count, when the canvas did not list them), the
 * surface, and, under a caption, what writing would do. Rows that would read zero are left out;
 * the writing group is left out without a proposal and after a failure.
 *
 * @returns {({ id: string, label: string, value: string }|{ id: string, caption: string })[]}
 */
export function handoffFacts(t, { findings, proposal, failure }) {
  const rows = [];
  const { edits } = findings;
  if (Array.isArray(edits) && edits.length) {
    rows.push({ id: 'edits', caption: t('Pending 3D edits') });
    edits.slice(0, EDIT_ROWS).forEach((edit, index) => rows.push(editRow(t, edit, index)));
    if (edits.length > EDIT_ROWS) {
      rows.push({ id: 'more', label: '', value: t('+{{count}} more', { count: edits.length - EDIT_ROWS }) });
    }
  } else {
    rows.push({
      id: 'edits',
      label: t('Unsynced edits'),
      value: findings.failed
        ? t('{{n}} ({{failed}} failed to write)', { n: _number(findings.unsynchronized), failed: _number(findings.failed) })
        : _number(findings.unsynchronized),
    });
  }
  rows.push({ id: 'surface', label: t('Surface'), value: surfaceSummary(t, findings) });
  if (!proposal || failure) {
    return rows;
  }
  rows.push({ id: 'writes', caption: t('Writing to the slices would') });
  // `count` picks the plural form, `n` is the grouped number shown
  const voxels = count => t('{{n}} voxels', { count, n: _number(count) });
  const changes = (proposal.remove || 0) + (proposal.add || 0);
  if (proposal.remove > 0) {
    rows.push({ id: 'removes', label: t('Remove'), value: voxels(proposal.remove) });
  }
  if (proposal.add > 0) {
    rows.push({ id: 'adds', label: t('Add'), value: voxels(proposal.add) });
  }
  // The removal depth of the Remove edits, which explains cleared voxels beyond the cut
  const depth = Array.isArray(edits) ? Math.max(0, ...edits.map(edit => (edit.kind === 'remove' || !edit.kind) && edit.depth > 0 ? edit.depth : 0)) : 0;
  if (depth > 0 && proposal.remove > 0) {
    rows.push({ id: 'depth', label: t('Removal depth'), value: `${depth} ${t(findings.lengthUnit || 'units')}` });
  }
  if (proposal.dropped > 0) {
    rows.push({ id: 'skips', label: t('Skip'), value: t('{{n}} voxels now in another segment', { count: proposal.dropped, n: _number(proposal.dropped) }) });
  }
  if (!changes) {
    rows.push({ id: 'change', label: t('Change'), value: t('No voxels') });
  } else if (proposal.domain) {
    const size = proposal.domain.max.map((max, axis) => max - proposal.domain.min[axis] + 1);
    rows.push({ id: 'region', label: t('Within'), value: t('{{i}} × {{j}} × {{k}} voxels', { i: size[0], j: size[1], k: size[2] }) });
  }
  return rows;
}

/**
 * The consequence lines: what the 2D slices will show and the one caveat the defects found
 * carry (the explanation #152 §5 asks for before confirmation: where the surface is damaged the
 * writer cannot tell inside from outside, so the slices, and the surface rebuilt from them, can
 * differ from the canvas there), then the bound as a muted line; a failed earlier write adds a
 * muted lead line. A failed write now replaces them; a missing proposal says writing is not
 * available.
 *
 * @returns {{ kind: 'retry'|'consequence'|'bound'|'unavailable'|'failure', tone: 'plain'|'muted'|'warning'|'destructive', text: string }[]}
 */
export function handoffNotices(t, { findings, proposal, failure }) {
  const state = _state(findings, proposal, failure);
  const count = findings.unsynchronized;
  if (failure) {
    return [{
      kind: 'failure',
      tone: 'destructive',
      text: failure.message
        ? t('Write failed: {{message}}. Nothing in the 2D slices changed; the {{count}} edits are still on the surface.', { message: failure.message, count })
        : t('Write failed. Nothing in the 2D slices changed; the {{count}} edits are still on the surface.', { count }),
    }];
  }
  if (!proposal) {
    return [{
      kind: 'unavailable',
      tone: 'warning',
      text: t('The write could not be previewed, so the voxel counts are unknown and writing is not available. Stay in 3D Tools, or discard the edits.', { count }),
    }];
  }
  const notices = [];
  if (findings.failed > 0) {
    notices.push({ kind: 'retry', tone: 'muted', text: t('The last write failed; writing tries again.') });
  }
  const changes = _changes(t, proposal);
  const region = _region(t, proposal);
  const vars = { segment: findings.segment, count, changes, region, open: _open(t, state.open), bad: _bad(t, state) };
  if (!changes) {
    notices.push({ kind: 'consequence', tone: 'plain', text: t('These edits change no voxel in the 2D slices of "{{segment}}"; writing leaves the slices as they are.', vars) });
    return notices;
  }
  let line;
  let bound;
  if (!state.checked) {
    line = { tone: 'warning', text: t('The 2D slices will show your edits: {{changes}} in "{{segment}}". The surface check has not finished, so it is not verified that the slices will match the canvas near the edits.', vars) };
    bound = t('Nothing outside {{region}} changes.', vars);
  } else if (state.clean) {
    line = { tone: 'plain', text: t('The 2D slices will show exactly what the canvas shows: {{changes}} in "{{segment}}". The surface is closed, so every change comes from your edits.', vars) };
    bound = t('Nothing outside {{region}} changes.', vars);
  } else if (state.bad && state.open > 0) {
    line = { tone: 'warning', text: t('The 2D slices will show your edits: {{changes}} in "{{segment}}". Near the {{open}} and along the {{bad}}, voxels can be cleared or kept differently than the canvas shows; Repair closes the open edges only.', vars) };
    bound = t('Nothing outside {{region}} changes. The damaged edges stay.', vars);
  } else if (state.bad) {
    line = { tone: 'warning', text: t('The 2D slices will show your edits: {{changes}} in "{{segment}}". Along the {{bad}}, which Repair cannot fix, inside and outside cannot be told apart, so voxels beside those edges can be cleared or kept differently than the canvas shows.', vars) };
    bound = t('Nothing outside {{region}} changes. The damaged edges stay.', vars);
  } else {
    line = { tone: 'warning', text: t('The 2D slices will show your cut: {{changes}} in "{{segment}}". Where the holes could not be closed, inside and outside cannot be told apart, so near those {{open}} some voxels can be cleared or kept differently than the canvas shows.', vars) };
    bound = t('Nothing outside {{region}} changes. The edges stay open.', vars);
  }
  notices.push({ kind: 'consequence', ...line });
  notices.push({ kind: 'bound', tone: 'muted', text: bound });
  return notices;
}

// Where the user lands after leaving, as a sentence of its own
function _then(t, reason, destination) {
  switch (reason) {
    case HANDOFF_REASONS.labelmap:
      return t('Then opens Labelmap Tools.');
    case HANDOFF_REASONS.target:
      return destination
        ? t('Then switches to "{{destination}}".', { destination: destination.label })
        : t('Then switches to the selected segment.');
    case HANDOFF_REASONS.import:
      return t('Then starts the import.');
    case HANDOFF_REASONS.exit:
      return t('Then closes the editor.');
    default:
      return t('You stay in 3D Tools.');
  }
}

// What the write does, as a menu line ending with where the user lands
function _writeDescription(t, { reason, destination, findings, proposal, failure, state }) {
  if (failure) {
    return t('Not available: the last write failed.');
  }
  if (!proposal) {
    return t('Not available: the write could not be previewed.');
  }
  const then = _then(t, reason, destination);
  const changes = _changes(t, proposal);
  const vars = { segment: findings.segment, changes, then, open: _open(t, state.open) };
  if (!changes) {
    return t('Changes no voxels. {{then}}', vars);
  }
  if (findings.failed > 0) {
    return t('Tries the write again: {{changes}} in "{{segment}}". {{then}}', vars);
  }
  if (!state.checked) {
    return t('{{changes}} in "{{segment}}"; surface not checked, match with the canvas not verified. {{then}}', vars);
  }
  if (state.clean) {
    return t('{{changes}} in "{{segment}}", exactly as the canvas shows. {{then}}', vars);
  }
  if (state.bad) {
    return t('{{changes}} in "{{segment}}"; beside the damaged edges the result can differ from the canvas. {{then}}', vars);
  }
  return t('{{changes}} in "{{segment}}"; near the {{open}} the result can differ from the canvas. {{then}}', vars);
}

/**
 * The footer: the cancel, Repair when there are open edges to close, and the way out (a
 * pull-down named after the destination holding Write and Discard; plain buttons for
 * Synchronize, which has no destination). Each control carries its hover text; each menu item
 * a line saying what it does and where the user lands.
 *
 * @returns {{
 *   defaultId: string,
 *   cancel: { id, label, tooltip, variant, isDefault },
 *   repair: { id, label, tooltip, variant, enabled, reason? }|null,
 *   discard: { id, label, tooltip, variant, enabled }|null,
 *   write: { id, label, tooltip, variant, enabled, hidden, isDefault, reason? }|null,
 *   leave: { label, tooltip, variant, isDefault, items: { id, title, description, enabled, destructive, isDefault }[] }|null,
 * }}
 */
export function handoffActions(t, { reason, destination = null, findings, proposal, failure }) {
  reason = _reason(reason);
  const state = _state(findings, proposal, failure);
  const { defaultId } = state;
  const sync = reason === HANDOFF_REASONS.sync;
  const count = findings.unsynchronized;
  const segment = findings.segment;
  const onTarget = findings.isTarget !== false;

  const CANCEL_TIPS = {
    [HANDOFF_REASONS.labelmap]: 'Returns to 3D Tools. Nothing is written and the toolbox does not switch.',
    [HANDOFF_REASONS.target]: onTarget
      ? 'Returns to 3D Tools. Nothing is written and the 3D tools stay on "{{segment}}".'
      : 'Returns to 3D Tools. Nothing is written and the 3D tools stay where they are.',
    [HANDOFF_REASONS.import]: 'Returns to 3D Tools. Nothing is written and the import is cancelled.',
    [HANDOFF_REASONS.exit]: 'Returns to 3D Tools. Nothing is written and the editor stays open.',
    [HANDOFF_REASONS.sync]: 'Closes this dialog. Nothing is written.',
  };
  const cancel = {
    id: HANDOFF_CHOICES.continue,
    label: sync ? t('Cancel') : t('Stay in 3D Tools'),
    tooltip: t(CANCEL_TIPS[reason], { segment }),
    variant: defaultId === HANDOFF_CHOICES.continue ? 'default' : 'outline',
    isDefault: defaultId === HANDOFF_CHOICES.continue,
  };

  const REPAIR_AFTER = {
    [HANDOFF_REASONS.labelmap]: 'switch toolbox again afterwards',
    [HANDOFF_REASONS.target]: 'select the segment again afterwards',
    [HANDOFF_REASONS.import]: 'start the import again afterwards',
    [HANDOFF_REASONS.exit]: 'press Exit again afterwards',
    [HANDOFF_REASONS.sync]: 'if no defect is left, Apply also writes it to the slices',
  };
  // Shown only when there are open edges to close: Repair closes open edges and nothing else
  const repair = state.open > 0 && !failure ? {
    id: HANDOFF_CHOICES.repair,
    label: t('Repair {{count}} open edges...', { count: state.open }),
    tooltip: t('Closes the {{open}} across the whole surface and shows the result to apply or cancel. You stay in 3D Tools; {{after}}.', {
      open: _open(t, state.open), after: t(REPAIR_AFTER[reason]),
    }),
    variant: 'secondary',
    enabled: onTarget,
    reason: onTarget ? undefined : t('Repair works on the active segment only. Stay in 3D Tools and select "{{segment}}" first.', { segment }),
  } : null;

  const writeDescription = _writeDescription(t, { reason, destination, findings, proposal, failure, state });
  const discardDescription = t('Drops the {{count}} 3D edits to "{{segment}}"; the 2D slices stay as they are. {{then}}', {
    count, segment, then: sync ? t('Redo in 3D Tools brings them back.', { count }) : _then(t, reason, destination),
  });

  if (sync) {
    return {
      defaultId,
      cancel,
      repair,
      discard: { id: HANDOFF_CHOICES.discard, label: t('Discard edits', { count }), tooltip: discardDescription, variant: 'destructive', enabled: true },
      write: {
        id: HANDOFF_CHOICES.proceed,
        label: t('Write to slices'),
        tooltip: writeDescription,
        variant: defaultId === HANDOFF_CHOICES.proceed ? 'default' : 'secondary',
        enabled: state.canSync,
        hidden: !!failure,
        isDefault: defaultId === HANDOFF_CHOICES.proceed,
        reason: !proposal && !failure ? t('Not available: the write could not be previewed.') : undefined,
      },
      leave: null,
    };
  }

  const LEAVE = {
    [HANDOFF_REASONS.labelmap]: { label: 'Switch toolbox', verb: 'switch toolbox' },
    [HANDOFF_REASONS.target]: { label: 'Switch segment', verb: 'switch segment' },
    [HANDOFF_REASONS.import]: { label: 'Import', verb: 'import' },
    [HANDOFF_REASONS.exit]: { label: 'Close editor', verb: 'close the editor' },
  };
  return {
    defaultId,
    cancel,
    repair,
    discard: null,
    write: null,
    leave: {
      label: t(LEAVE[reason].label),
      tooltip: t('Two ways to {{verb}}: write the edits to the slices, or discard them.', { count, verb: t(LEAVE[reason].verb) }),
      variant: defaultId === HANDOFF_CHOICES.proceed ? 'default' : 'secondary',
      isDefault: defaultId === HANDOFF_CHOICES.proceed,
      items: [
        {
          id: HANDOFF_CHOICES.proceed,
          title: t('Write edits to slices', { count }),
          description: writeDescription,
          enabled: state.canSync,
          destructive: false,
          isDefault: defaultId === HANDOFF_CHOICES.proceed,
        },
        {
          id: HANDOFF_CHOICES.discard,
          title: t('Discard edits', { count }),
          description: discardDescription,
          enabled: true,
          destructive: true,
          isDefault: false,
        },
      ],
    },
  };
}

/** The availability hints shown above the footer: a button that is shown but disabled. */
export function handoffHints(actions) {
  return [actions.repair, actions.write]
    .filter(action => action && !action.hidden && !action.enabled && action.reason)
    .map(action => action.reason);
}

const TONE_CLASS = {
  warning: 'text-[#e3b341]',
  plain: 'text-white',
  muted: 'text-muted-foreground',
  destructive: 'text-[#ff7c7c]',
};

const BUTTON_CLASS = 'h-8 min-w-[96px] px-3.5 text-sm font-medium';
const TIP_CLASS = 'max-w-[280px] text-[13px] leading-[18px]';

export function HandoffDialog({ headerTitle, body, facts, notices, actions, onChoose, rootClass = '' }) {
  const rootRef = useRef(null);
  const defaultRef = useRef(null);
  const contentRef = useRef(null);
  // The dialog element, once mounted: tooltips and the menu are portalled into it so they stack
  // above the dialog's own layer
  const [portal, setPortal] = useState(null);
  const setRoot = useCallback(element => {
    rootRef.current = element;
    setPortal(element);
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;
  const [leaveTip, setLeaveTip] = useState(false);

  const { defaultId } = actions;
  const choose = useCallback(id => onChoose(id), [onChoose]);
  const stay = useCallback(() => choose(HANDOFF_CHOICES.continue), [choose]);
  const hints = handoffHints(actions);

  useEffect(() => {
    // The default button takes focus; when Return performs the write, the content does, so the
    // first Tab lands on the cancel
    (defaultRef.current || contentRef.current)?.focus?.();
  }, []);

  useEffect(() => {
    const onKeyDown = event => {
      // The open menu owns Escape (closes it) and Return (activates the focused item)
      if (menuOpenRef.current) {
        return;
      }
      const action = confirmDialogKeyAction(event, rootRef.current);
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action === 'cancel') {
        stay();
      } else {
        choose(defaultId);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [choose, stay, defaultId]);

  const tip = (text, trigger, open) => (
    <Tooltip delayDuration={500} {...(open === undefined ? {} : { open })} onOpenChange={open === undefined ? undefined : setLeaveTip}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent container={portal} side="top" className={TIP_CLASS}>{text}</TooltipContent>
    </Tooltip>
  );

  const button = action => action && !action.hidden && tip(action.tooltip, (
    <Button
      ref={action.id === defaultId ? defaultRef : undefined}
      variant={action.variant}
      className={BUTTON_CLASS}
      disabled={action.enabled === false}
      onClick={() => action.enabled !== false && choose(action.id)}
      data-cy={`seg-editor-handoff-${action.id}`}
      data-default={action.id === defaultId ? 'true' : undefined}
    >
      {action.label}
    </Button>
  ));

  const { leave } = actions;
  const leaveMenu = leave && (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {tip(leave.tooltip, (
        <DropdownMenuTrigger asChild>
          <Button
            variant={leave.variant}
            className={`${BUTTON_CLASS} gap-1.5 pr-2.5`}
            data-cy="seg-editor-handoff-leave"
            data-default={leave.isDefault ? 'true' : undefined}
          >
            {leave.label}
            <Icons.ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
      ), leaveTip && !menuOpen)}
      <DropdownMenuContent container={portal} align="end" sideOffset={6} className="w-[360px] p-1" data-cy="seg-editor-handoff-menu">
        {leave.items.map((item, index) => (
          <React.Fragment key={item.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              disabled={!item.enabled}
              onSelect={() => choose(item.id)}
              className="flex-col items-start gap-0.5 px-3 py-2"
              data-cy={`seg-editor-handoff-${item.id}`}
            >
              <div className={`flex w-full items-center text-sm font-medium leading-5 ${item.destructive ? 'text-[#ff7c7c]' : 'text-white'}`}>
                {item.title}
                {item.isDefault && item.enabled && <span className="ml-auto pl-3 text-[13px] opacity-60" aria-hidden="true">⏎</span>}
              </div>
              <div className="text-muted-foreground text-[13px] leading-[18px]">{item.description}</div>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <TooltipProvider>
      <SimpleDialogShell componentRef={setRoot} headerTitle={headerTitle} onClose={stay} rootClass={rootClass}>
        <div ref={contentRef} tabIndex={-1} className="content w-[520px] max-w-[88vw] outline-none" data-cy="seg-editor-handoff">
          <p className="m-0 text-[15px] leading-[22px] text-white">{body}</p>
          <dl
            className="my-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-y border-white/10 py-3 text-sm leading-5"
            data-cy="seg-editor-handoff-facts"
          >
            {facts.map(row => (row.caption ? (
              <div key={row.id} className="text-muted-foreground col-span-2 mt-2 text-[13px] leading-[18px] first:mt-0" data-cy={`seg-editor-handoff-${row.id}`}>
                {row.caption}
              </div>
            ) : (
              <React.Fragment key={row.id}>
                <dt className="text-muted-foreground font-medium">{row.label}</dt>
                <dd className="m-0 text-right tabular-nums text-white" data-cy={`seg-editor-handoff-${row.id}`}>{row.value}</dd>
              </React.Fragment>
            )))}
          </dl>
          {notices.map(notice => (
            <p
              key={notice.kind}
              className={`m-0 ${notice.kind === 'bound' ? 'mt-1 text-[13px] leading-[18px]' : 'mt-2 text-sm leading-5'} ${TONE_CLASS[notice.tone]}`}
              role="status"
              data-cy={`seg-editor-handoff-${notice.kind}`}
            >
              {notice.text}
            </p>
          ))}
          {hints.length > 0 && (
            <div className="text-muted-foreground mt-3 text-[13px] leading-[18px]" data-cy="seg-editor-handoff-hints">
              {hints.map(hint => <p key={hint} className="m-0">{hint}</p>)}
            </div>
          )}
        </div>
        <div className="footer flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {button(actions.cancel)}
            {button(actions.discard)}
          </div>
          <div className="flex items-center gap-2">
            {button(actions.repair)}
            {button(actions.write)}
            {leaveMenu}
          </div>
        </div>
      </SimpleDialogShell>
    </TooltipProvider>
  );
}

const actionShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  tooltip: PropTypes.string,
  variant: PropTypes.string.isRequired,
  enabled: PropTypes.bool,
  hidden: PropTypes.bool,
  isDefault: PropTypes.bool,
  reason: PropTypes.string,
});

HandoffDialog.propTypes = {
  headerTitle: PropTypes.string,
  body: PropTypes.string.isRequired,
  facts: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired, label: PropTypes.string, value: PropTypes.string, caption: PropTypes.string,
  })).isRequired,
  notices: PropTypes.arrayOf(PropTypes.shape({ kind: PropTypes.string, tone: PropTypes.string, text: PropTypes.string })).isRequired,
  actions: PropTypes.shape({
    defaultId: PropTypes.string.isRequired,
    cancel: actionShape.isRequired,
    repair: actionShape,
    discard: actionShape,
    write: actionShape,
    leave: PropTypes.shape({
      label: PropTypes.string.isRequired,
      tooltip: PropTypes.string,
      variant: PropTypes.string.isRequired,
      isDefault: PropTypes.bool,
      items: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        title: PropTypes.string.isRequired,
        description: PropTypes.string,
        enabled: PropTypes.bool,
        destructive: PropTypes.bool,
        isDefault: PropTypes.bool,
      })).isRequired,
    }),
  }).isRequired,
  /** Called with the chosen HANDOFF_CHOICES id */
  onChoose: PropTypes.func.isRequired,
  rootClass: PropTypes.string,
};

/**
 * Ask how to resolve the handoff.
 *
 * @param {Object} params
 * @param {Object} params.uiDialogService
 * @param {Function} params.t
 * @param {string} [params.id]
 * @param {string} params.reason - HANDOFF_REASONS
 * @param {{ segmentIndex: number, label: string }|null} [params.destination] - for a target
 *   change, the segment selected
 * @param {Object} params.findings - { segment, unsynchronized, failed, defects, checked, isTarget,
 *   edits?, lengthUnit? }
 * @param {Object|null} params.proposal - proposeSurfaceSync's result, or null when it failed
 * @param {Object|null} params.failure - { message } of the last failed conversion or proposal
 * @returns {Promise<string>} the HANDOFF_CHOICES id (continue when dismissed)
 */
export function callHandoffDialog({
  uiDialogService, t, id = 'seg-editor-3d-handoff', reason, destination = null, findings, proposal = null, failure = null,
}) {
  return new Promise(resolve => {
    let settled = false;
    const settle = choice => {
      if (!settled) {
        settled = true;
        uiDialogService.dismiss({ id });
        resolve(Object.values(HANDOFF_CHOICES).includes(choice) ? choice : HANDOFF_CHOICES.continue);
      }
    };
    const title = handoffTitle(t, reason);
    uiDialogService.show({
      id,
      content: HandoffDialog,
      title,
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      contentProps: {
        headerTitle: title,
        body: handoffBody(t, { reason, destination, findings, proposal, failure }),
        facts: handoffFacts(t, { findings, proposal, failure }),
        notices: handoffNotices(t, { findings, proposal, failure }),
        actions: handoffActions(t, { reason, destination, findings, proposal, failure }),
        rootClass: 'sonadorSimpleInputDialog sonadorSegEditorHandoff',
        onChoose: settle,
      },
    });
  });
}

export default callHandoffDialog;
