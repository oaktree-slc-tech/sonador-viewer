import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { Button, Icons } from '@ohif/ui-next';

import { meshColorFor } from '../threeDTools/editModeOverlay';
import {
  EDIT_SETTINGS,
  get3DToolState,
  is3DTargetEditable,
  LASSO_SHAPES,
  LENGTH_BASIS,
  PAINT_MODES,
  request3DToolAction,
  SELECTION_ACTIONS,
  set3DToolOption,
  SMOOTH_PASSES,
  SMOOTH_STRENGTH,
  subscribe3DToolState,
  THREE_D_TOOLS,
  WELD_FRACTION,
} from '../threeDTools/threeDToolState';
import { setMeshColor, useMeshColor } from '../utils/meshColor';
import { setPreviewColor, usePreviewColor } from '../utils/previewColor';
import { isDeveloperToolsEnabled } from '../utils/segEditorDeveloper';
import { unitHintFor, useSegEditorUnits } from '../utils/segEditorUnits';

import { AdvancedField, Card, ColorSwatch, SegmentedRow, SliderRow, Tip, ToggleRow } from './panelControls';


// The 3D Selection tool's panel (ohif-viewers#142, §12), as grouped cards: what is selected, then
// the action on the selection (Remove or Smooth) with its parameters. Every card shares one left
// edge and one row grammar (label leading, control trailing); an operation's parameters sit in
// its card and are shown only while it applies; the card's own action row is its primary, and
// while an edit is shown for Apply / Cancel that row is the only primary offered. What acts on
// the whole surface (Repair, Synchronize, the surface health) lives apart, in the palette's
// status block and "⋯" menu (WholeSurface.jsx; owner's review of 2026-10-26). Settings live in
// the 3D tool state; actions reach the canvas through its request channel.

const number = value => Number(value || 0).toLocaleString();

const SEGMENTS = {
  lassoShape: [LASSO_SHAPES.lasso, LASSO_SHAPES.box],
  paintMode: [PAINT_MODES.paint, PAINT_MODES.erase],
  closure: ['auto', 'smooth', 'flat'],
  rimCleanup: ['off', 'light', 'full'],
};

const SEGMENT_LABELS = {
  lasso: 'Freehand', box: 'Box', paint: 'Paint', erase: 'Erase',
  auto: 'Auto', smooth: 'Smooth', flat: 'Flat', off: 'Off', light: 'Light', full: 'Full',
};

/** A gentle wave: Smooth. */
function SmoothIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M3 15c3-5 6-5 9 0s6 5 9 0" />
    </svg>
  );
}

// The action cards, one shown at a time: the row's button, its icon, and the help shown on hover
const ACTIONS = [
  {
    id: 'remove',
    label: 'Remove',
    Icon: props => <Icons.Trash {...props} />,
    hint: 'Removes the selected faces and closes the hole they leave.',
  },
  {
    id: 'smooth',
    label: 'Smooth',
    Icon: SmoothIcon,
    hint: 'Evens out the selected faces. Their edge stays in place, or eases with Soft edge.',
  },
];

// Advanced removal settings, as counts. The weld is a developer setting (ohif-viewers#149 FR-1,
// #151 FR-4): a fraction of the surface's first-percentile edge length, shown with the developer
// tools only, exact otherwise.
const ADVANCED = [
  { key: 'maxConstraints', label: 'Patch constraints', unit: 'pts', unitHint: 'Boundary points; at most 8, two fits per hole', step: 1 },
  { key: 'islandMaxTriangles', label: 'Drop islands under', unit: 'tris', unitHint: 'Triangles', step: 1 },
];
const WELD_FIELD = {
  key: 'weldFraction', label: 'Weld', unit: '× p1', step: WELD_FRACTION.step,
  unitHint: 'A fraction of the surface\'s first-percentile edge length, at most 0.1; 0 welds exact duplicates only. A weld that would drop or turn over sound triangles is not applied.',
};

export default function SelectionToolPanel({ tool = THREE_D_TOOLS.Lasso }) {
  const { t } = useTranslation('SegmentationEditor');
  const [state, setState] = useState(get3DToolState);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const developer = isDeveloperToolsEnabled();

  useEffect(() => subscribe3DToolState(setState), []);

  // Lengths are in the reference series' patient units: mm, or the grid's steps without a patient
  // calibration (the hint says why: no spacing, a detector spacing only, a malformed value)
  const units = useSegEditorUnits();
  const lengthUnit = t(units.length);
  const unitHint = unitHintFor(units);
  const lengthHint = unitHint ? t(unitHint) : undefined;

  // Depth and Brush size as the state resolves them (ohif-viewers#151 FR-3): in world units on a
  // calibrated grid, with the same length read in voxels beneath; in voxel units (whole steps of
  // the grid's smallest spacing) on an uncalibrated grid whose steps are known, with the length in
  // grid units beneath. The cells' sizes are shown with either, so a count on an anisotropic grid
  // is not read as that many cells along every axis.
  const depth = state.lengths.removalDepth;
  const brush = state.lengths.paintRadius;
  const round3 = value => Number(Number(value).toPrecision(3));
  const cellsOf = spacing => spacing.map(round3).join(' × ');
  const lengthUnitFor = length => (length.basis === LENGTH_BASIS.voxels ? t('vox') : lengthUnit);
  const lengthHintFor = length => (length.basis === LENGTH_BASIS.voxels
    ? [
      length.reference
        ? t("Voxel units: whole steps of the grid's smallest spacing ({{step}}). The cells are {{cells}} across, so a count is not that many cells along every axis.", { step: round3(length.reference), cells: cellsOf(length.spacing) })
        : t('Voxel units: whole steps of the grid\'s smallest spacing.'),
      lengthHint,
    ].filter(Boolean).join(' ')
    : lengthHint);
  const lengthNote = length => {
    if (!length.reference) {
      return undefined;
    }
    return length.basis === LENGTH_BASIS.voxels
      ? t('= {{world}} grid units · cells {{cells}}', { world: round3(length.world), cells: cellsOf(length.spacing) })
      : t('≈ {{count}} voxel(s) · cells {{cells}} {{unit}}', { count: round3(length.voxels), cells: cellsOf(length.spacing), unit: lengthUnit });
  };
  const segments = key => SEGMENTS[key].map(value => ({ value, label: t(SEGMENT_LABELS[value]) }));

  // The colour a pending edit's changed faces are drawn in (a user preference, also on the
  // Settings page, General > Segmentation Editor)
  const previewColor = usePreviewColor();
  // The mesh colour: following the segment (the default) or the user's pick; the swatch shows the
  // colour in effect for the target and a pick sets it (the Model Actions menu offers the
  // segment's own shades and a way back to following the segment)
  const meshColor = useMeshColor();
  const effectiveMeshColor = `#${meshColorFor(state.target?.color, meshColor).getHexString()}`;
  const previewSwatch = id => (
    <ColorSwatch
      id={id}
      label={t('Preview colour')}
      hint={t('The colour an edit awaiting Apply is drawn in. Also in Settings > General > Segmentation Editor.')}
      value={previewColor}
      onChange={setPreviewColor}
    />
  );

  const { target, selectionCount, selectionPoints, selectionRegions, preview, surfaceHealth, busy } = state;
  const hasSelection = selectionCount > 0;
  const editable = is3DTargetEditable(state);
  const previewingSmooth = preview?.kind === 'smooth';
  const previewingRemoval = !!preview && !preview.repair && !previewingSmooth;
  const painting = tool === THREE_D_TOOLS.Paint;
  const { action } = state;
  const request = name => request3DToolAction(name);
  const set = (key, value) => set3DToolOption(key, value);

  // An edit of the selection shown for Apply / Cancel brings its own action card up, wherever it
  // was started (a repair's Apply / Cancel live in the Repair surface dialog)
  useEffect(() => {
    if (preview && !preview.repair) {
      set3DToolOption('action', preview.kind === 'smooth' ? SELECTION_ACTIONS.smooth : SELECTION_ACTIONS.remove);
    }
  }, [preview]);

  // The action row of a card while its edit is shown for Apply / Cancel
  const previewRow = (note, applyLabel, cancelCy, applyCy) => (
    <div className="flex flex-col gap-2 pt-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs" role="status">{note}</p>
        {previewSwatch(`${applyCy}-color`)}
      </div>
      <div className="flex gap-2 pt-1">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => request('cancelPreview')} data-cy={cancelCy}>
          {t('Cancel')}
        </Button>
        <Button size="lg" className="flex-1" onClick={() => request('applyPreview')} data-cy={applyCy}>
          {applyLabel}
        </Button>
      </div>
    </div>
  );

  const health = surfaceHealth;
  const advancedFields = developer ? [ADVANCED[0], WELD_FIELD, ADVANCED[1]] : ADVANCED;
  const advancedSummary = developer
    ? t('Advanced: {{constraints}} patch constraints, weld {{weld}} × p1, islands under {{island}} tris', {
      constraints: state.maxConstraints, weld: state.weldFraction, island: state.islandMaxTriangles,
    })
    : t('Advanced: {{constraints}} patch constraints, islands under {{island}} tris', {
      constraints: state.maxConstraints, island: state.islandMaxTriangles,
    });

  return (
    <div className="text-foreground flex flex-col gap-2.5 px-1 py-1 text-[13px]" data-cy="seg-editor-selection-panel">

      <Card
        title={painting ? t('Paint') : t('Lasso')}
        dataCy="seg-editor-selection-card"
        action={hasSelection && !preview && (
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => request('clearSelection')} data-cy="seg-editor-clear-selection">
            {t('Clear')}
          </Button>
        )}
      >
        {hasSelection ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 leading-tight">
              <span className="text-xl font-semibold tabular-nums" data-cy="seg-editor-selection-count">
                {number(painting ? selectionCount : selectionPoints)}
              </span>
              <span className="text-muted-foreground"> {painting ? t('faces') : t('points')}</span>
              <div className="text-muted-foreground text-xs">
                {painting
                  ? t('{{count}} points, {{regions}} region(s)', { count: number(selectionPoints), regions: selectionRegions })
                  : t('{{count}} faces, {{regions}} region(s)', { count: number(selectionCount), regions: selectionRegions })}
              </div>
            </div>
            {!preview && (
            <div className="border-input/60 flex flex-none overflow-hidden rounded-md border" role="group" aria-label={t('Grow or shrink the selection')}>
              <Tip text={t('Shrink the selection by one ring of faces')}>
                <Button variant="ghost" className="h-8 w-10 rounded-none px-0" disabled={!editable} aria-label={t('Shrink')} onClick={() => request('shrinkSelection')} data-cy="seg-editor-shrink-selection">
                  <Icons.Minus className="h-4 w-4" />
                </Button>
              </Tip>
              <span className="bg-input/60 w-px" aria-hidden="true" />
              <Tip text={t('Grow the selection by one ring of faces')}>
                <Button variant="ghost" className="h-8 w-10 rounded-none px-0" disabled={!editable} aria-label={t('Grow')} onClick={() => request('growSelection')} data-cy="seg-editor-grow-selection">
                  <Icons.Add className="h-4 w-4" />
                </Button>
              </Tip>
            </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs leading-snug">
            {target?.disabledReason || (painting
              ? t('Drag over the model to paint faces. Ctrl erases.')
              : t('Lasso-drag on the model to select faces, shown by their points. Shift adds, Ctrl removes.'))}
          </p>
        )}
        {!preview && (painting ? (
          <>
            <SegmentedRow
              id="seg-editor-paint-mode"
              label={t('Brush')}
              hint={t('Paint adds faces to the selection, Erase takes them out. Ctrl erases while held.')}
              value={state.paintMode}
              items={segments('paintMode')}
              disabled={!!preview}
              onChange={value => set('paintMode', value)}
            />
            <SliderRow
              id="seg-editor-paint-radius"
              label={t('Brush size')}
              hint={t('Radius of the brush')}
              unit={lengthUnitFor(brush)}
              unitHint={lengthHintFor(brush)}
              value={brush.value}
              range={brush.range}
              disabled={!!preview}
              onChange={value => set(brush.settingKey, value)}
              note={lengthNote(brush)}
            />
          </>
        ) : (
          <>
            <SegmentedRow
              id="seg-editor-lasso-shape"
              label={t('Shape')}
              hint={t('Freehand draws an outline; Box drags out a rectangle')}
              value={state.lassoShape}
              items={segments('lassoShape')}
              disabled={!!preview}
              onChange={value => set('lassoShape', value)}
            />
            <ToggleRow
              id="seg-editor-connected-only"
              label={t('Keep largest piece only')}
              description={t('A lasso keeps only the largest connected part of what it selects')}
              checked={state.connectedOnly}
              onChange={value => set('connectedOnly', value)}
            />
          </>
        ))}
        <ToggleRow
          id="seg-editor-show-mesh"
          label={t('Show mesh')}
          description={t('Draw every edge and vertex of the selected segment, as Blender\'s edit mode does')}
          checked={state.showMesh}
          onChange={value => set('showMesh', value)}
          control={(
            <ColorSwatch
              id="seg-editor-mesh-color"
              label={t('Mesh colour')}
              hint={t('The colour the mesh of the selected segment is drawn in. Also in Settings > General > Segmentation Editor.')}
              value={effectiveMeshColor}
              onChange={setMeshColor}
            />
          )}
        />
      </Card>

      <div className="flex gap-1 px-0.5" role="tablist" aria-label={t('Action')} data-cy="seg-editor-action-row">
        {ACTIONS.map(({ id, label, Icon: ActionIcon, hint }) => (
          <Tip
            key={id}
            text={t(hint)}
          >
            <Button
              role="tab"
              aria-selected={action === id}
              variant={action === id ? 'secondary' : 'ghost'}
              size="sm"
              className={`h-7 flex-1 gap-1.5 text-xs ${action === id ? '' : 'text-muted-foreground'}`}
              disabled={!!preview && action !== id}
              onClick={() => set('action', id)}
              data-cy={`seg-editor-action-${id}`}
            >
              <ActionIcon className="h-3.5 w-3.5 flex-none" />
              {t(label)}
            </Button>
          </Tip>
        ))}
      </div>

      {action === SELECTION_ACTIONS.remove && (
        <Card title={t('Remove')} dataCy="seg-editor-remove-card">
          <p className="text-muted-foreground -mt-1 text-xs">{t('Removes the selected faces and closes the hole they leave.')}</p>
          <SegmentedRow
            id="seg-editor-closure"
            label={t('Closure')}
            hint={t('How the hole is filled: flat for small holes and smooth for larger ones, or always one of them')}
            value={state.closure}
            items={segments('closure')}
            disabled={!!preview}
            onChange={value => set('closure', value)}
          />
          <SegmentedRow
            id="seg-editor-rim-cleanup"
            label={t('Rim cleanup')}
            hint={t('Loose triangles and small islands are removed along the cut before the hole is filled')}
            value={state.rimCleanup}
            items={segments('rimCleanup')}
            disabled={!!preview}
            onChange={value => set('rimCleanup', value)}
          />
          <SliderRow
            id="seg-editor-depth"
            label={t('Depth')}
            hint={t("Also removes the segment's voxels within this distance of the removed points in the 2D views")}
            unit={lengthUnitFor(depth)}
            unitHint={lengthHintFor(depth)}
            value={depth.value}
            range={depth.range}
            disabled={!!preview}
            onChange={value => set(depth.settingKey, value)}
            note={lengthNote(depth)}
          />
          <button
            type="button"
            className="text-muted-foreground mt-1.5 flex w-full items-center gap-1.5 text-left text-xs"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen(open => !open)}
            data-cy="seg-editor-advanced-toggle"
          >
            <span className={`inline-block transition-transform ${advancedOpen ? 'rotate-90' : ''}`} aria-hidden="true">▸</span>
            <span className="truncate">
              {advancedOpen ? t('Advanced') : advancedSummary}
            </span>
          </button>
          {advancedOpen && (
            <div className="border-input/60 flex flex-col gap-2 border-l-2 pl-3">
              {advancedFields.map(({ key, label, unit, unitHint, step }) => (
                <AdvancedField
                  key={key}
                  id={`seg-editor-advanced-${key}`}
                  label={t(label)}
                  unit={t(unit)}
                  unitHint={t(unitHint)}
                  step={step}
                  value={state[key]}
                  range={EDIT_SETTINGS[key]}
                  disabled={!!preview}
                  onChange={value => set(key, value)}
                />
              ))}
              {developer && health?.edges?.p1 > 0 && (
                <p className="text-muted-foreground text-xs" data-cy="seg-editor-edge-statistics">
                  {t('Edge lengths: p1 {{p1}}, median {{p50}} {{unit}}{{sampled}}', {
                    p1: health.edges.p1.toPrecision(3), p50: health.edges.p50.toPrecision(3), unit: lengthUnit,
                    sampled: health.edges.sampled ? ` (${t('sample of {{count}}', { count: number(health.edges.sampleSize) })})` : '',
                  })}
                  {state.weldFraction > 0 && ` · ${t('weld {{tolerance}} {{unit}}', { tolerance: (health.weldTolerance || 0).toPrecision(3), unit: lengthUnit })}`}
                </p>
              )}
            </div>
          )}
          {previewingRemoval
            ? previewRow(t('Preview: the new patches are highlighted. Enter applies, Esc cancels.'), t('Apply'),
              'seg-editor-cancel-preview', 'seg-editor-apply-preview')
            : (
              <div className="flex items-center gap-3 pt-0.5">
                <ToggleRow
                  id="seg-editor-preview-enabled"
                  label={t('Preview')}
                  hint={t('Show the result before it is applied')}
                  checked={state.previewEnabled}
                  onChange={value => set('previewEnabled', value)}
                />
                {previewSwatch('seg-editor-preview-color')}
                {/* The counts are in the tip so the label fits beside the toggle and the swatch.
                    The tip hangs on a wrapper: a disabled button takes no pointer events. */}
                <Tip
                  text={hasSelection
                    ? t('Removes {{faces}} faces, {{points}} points, in {{regions}} region(s)', {
                      faces: number(selectionCount), points: number(selectionPoints), regions: selectionRegions,
                    })
                    : t('Select faces to remove')}
                >
                  <span className="flex min-w-0 flex-1" data-cy="seg-editor-remove-selection-tip">
                    <Button
                      variant="destructive"
                      size="lg"
                      className="w-full"
                      disabled={!editable || !hasSelection}
                      onClick={() => request('deleteSelection')}
                      data-cy="seg-editor-remove-selection"
                    >
                      {t('Remove')}
                    </Button>
                  </span>
                </Tip>
              </div>
            )}
        </Card>
      )}

      {action === SELECTION_ACTIONS.smooth && (
        <Card title={t('Smooth')} dataCy="seg-editor-smooth-card">
          <p className="text-muted-foreground -mt-1 text-xs">{t('Evens out the selected faces. Their edge stays in place, or eases with Soft edge.')}</p>
          <SliderRow
            id="seg-editor-smooth-strength"
            label={t('Strength')}
            hint={t('How far each pass moves a point towards its neighbours')}
            value={state.smoothStrength}
            range={SMOOTH_STRENGTH}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothStrength', value)}
          />
          <SliderRow
            id="seg-editor-smooth-passes"
            label={t('Passes')}
            hint={t('How many times the pass is repeated')}
            value={state.smoothPasses}
            range={SMOOTH_PASSES}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothPasses', value)}
          />
          <ToggleRow
            id="seg-editor-smooth-feather"
            label={t('Soft edge')}
            description={t('The edge of the selection eases at half strength instead of staying pinned, so the transition is not creased')}
            checked={state.smoothFeather}
            disabled={!!preview && !previewingSmooth}
            onChange={value => set('smoothFeather', value)}
          />
          {previewingSmooth
            ? previewRow(t('Preview: the smoothed faces are highlighted. Changing the settings updates them. Enter applies, Esc cancels.'), t('Apply'),
              'seg-editor-cancel-smooth', 'seg-editor-apply-smooth')
            : (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={!editable || !hasSelection || busy}
                onClick={() => request('smoothSelection')}
                data-cy="seg-editor-smooth-selection"
              >
                {t('Smooth {{count}} faces', { count: number(selectionCount) })}
              </Button>
            )}
        </Card>
      )}

    </div>
  );
}

SelectionToolPanel.propTypes = {
  // THREE_D_TOOLS: which tool's card leads the panel
  tool: PropTypes.string,
};
